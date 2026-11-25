"""Dedicated ephemeral Playwright browser; no attachment to user browser profiles."""
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4
import re
from security.hard_floor import (assert_file_allowed, assert_network_allowed, load_hard_floor,
                                 require_isolated_execution)

class AuthRequired(Exception): pass


def origin(url):
    u=urlsplit(url)
    if u.scheme not in {"http","https"} or not u.hostname or u.username or u.password:
        raise ValueError("HTTP(S) URL without credentials required")
    port=u.port or (443 if u.scheme=="https" else 80)
    return (u.scheme,u.hostname.lower(),port)

class ApocTools:
    def __init__(self, allowed_origins, output_dir, *, headless=True):
        load_hard_floor()
        self.allowed={origin(url) for url in allowed_origins}
        if not self.allowed: raise ValueError("Host must supply allowed browser origins")
        self.output=Path(output_dir).resolve()
        assert_file_allowed(self.output/'apoc-screenshot.png', operation='write')
        self.output.mkdir(parents=True,exist_ok=True)
        self.headless=headless;self.auth_reason=None
        self.pw=self.browser=self.context=self.page=None

    def __enter__(self):
        # Playwright request routes do not cover every browser transport (for
        # example WebRTC). Browser startup needs OS-enforced egress isolation.
        require_isolated_execution("apoc_browser")
        from playwright.sync_api import sync_playwright
        self.pw=sync_playwright().start()
        try:
            self.browser=self.pw.chromium.launch(headless=self.headless)
            self.context=self.browser.new_context(accept_downloads=False,service_workers="block")
            self.context.set_default_timeout(10000)
            self.context.route("**/*",self._route)
            self.context.on("response",self._response)
            self.page=self.context.new_page()
            self.context.on("page",lambda p:p.close() if p!=self.page else None)
            return self
        except Exception:
            self.__exit__(None,None,None);raise

    def __exit__(self,*args):
        try:
            if self.context:self.context.close()
        finally:
            try:
                if self.browser:self.browser.close()
            finally:
                if self.pw:self.pw.stop()
        self.context=self.browser=self.page=self.pw=None

    def _route(self,route):
        try:
            assert_network_allowed(route.request.url)
            permitted=origin(route.request.url) in self.allowed
        except (ValueError, PermissionError): permitted=False
        if permitted and not self.auth_reason:route.continue_()
        else:route.abort()

    def _response(self,response):
        if response.status in (401,403):self.auth_reason="HTTP authentication or access denial"

    def _guard(self):
        if not self.page:raise RuntimeError("Browser session not started")
        if self.auth_reason:raise AuthRequired(self.auth_reason)
        if self.page.url!="about:blank":
            assert_network_allowed(self.page.url)
            if origin(self.page.url) not in self.allowed:raise PermissionError("Origin outside task scope")
            if re.search(r"/(login|signin|sign-in|oauth|authorize)(?:[/?#]|$)",self.page.url,re.I):
                self.auth_reason="Login or authorization page"
            if self.page.locator('input[type="password"]').count():
                self.auth_reason="Password field detected"
            if self.auth_reason:raise AuthRequired(self.auth_reason)

    def browser_use(self,url=None,selector=None):
        self._guard()
        if (url is None)==(selector is None):raise ValueError("Supply a URL or click selector")
        if url is not None:
            assert_network_allowed(url)
            if origin(url) not in self.allowed:raise PermissionError("Origin outside task scope")
            self.page.goto(url,wait_until="domcontentloaded",timeout=20000)
        else:self.page.locator(selector).click()
        self._guard()
        return {"status":"completed","url":self.page.url,"title":self.page.title()}

    def web_scrape(self,selector="body"):
        self._guard()
        return {"status":"completed","url":self.page.url,"text":self.page.locator(selector).inner_text()[:30000]}

    def form_fill(self,selector,value):
        self._guard()
        if not isinstance(value,str) or len(value)>10000:raise ValueError("Invalid form value")
        field=self.page.locator(selector)
        if (field.get_attribute("type") or "").lower()=="password":raise AuthRequired("Credential field")
        field.fill(value);self._guard()
        return {"status":"completed","selector":selector}

    def screenshot(self):
        self._guard();path=self.output/(uuid4().hex+".png")
        assert_file_allowed(path, operation='write')
        self.page.screenshot(path=str(path),full_page=False)
        return {"status":"completed","path":str(path)}

    def cookies(self,operation="list"):
        self._guard()
        if operation=="clear":self.context.clear_cookies();return {"status":"completed"}
        if operation!="list":raise ValueError("Only list metadata or clear session cookies")
        return {"status":"completed","cookies":[{k:c[k] for k in ("name","domain","path","expires","httpOnly","secure")} for c in self.context.cookies()]}

    @staticmethod
    def definitions():
        return {"browser_use":{"url":"optional URL","selector":"optional click selector; exactly one required"},
            "web_scrape":{"selector":"optional CSS selector"},"form_fill":{"selector":"CSS selector","value":"text"},
            "screenshot":{},"cookies":{"operation":"list or clear; values never exported"}}
