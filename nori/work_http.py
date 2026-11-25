"""Authenticated desktop work routes for the existing Council HTTP listener."""
import asyncio
import hmac
import json
import re
from uuid import uuid4
from urllib.parse import parse_qs, urlsplit

from work_sessions import ArtifactAccessError, NativeTaskQualificationError


_TASK_PATH = re.compile(r"^/work/([A-Za-z0-9_-]{1,80})(/(?:cancel|resume))?$")
_ARTIFACT_PATH = re.compile(r'^/work/([a-f0-9]{32})/artifacts(?:/(0|[1-9][0-9]{0,8})/([a-f0-9]{64}))?$')
_ROUTINE_PATH = re.compile(r'^/proactive/routines(?:/([a-f0-9]{32})/disable)?$')
_MONITOR_PATH = re.compile(r'^/proactive/monitors(?:/([a-f0-9]{32})/disable)?$')


def _audit_proactive(gateway, operation, outcome='authenticated'):
    from bus import AgentName, Message
    gateway.sentinel.log(Message(
        AgentName.ARCHITECT, AgentName.ARCHITECT, operation,
        {'_id': uuid4().hex, '_credential': '[redacted]'}), outcome)


def handle_work(handler, worker, token, gateway):
    """Handle /work routes, returning False for unrelated paths.

    Work state lives on the Council loop; HTTP threads never mutate it directly.
    Both reads and writes require the desktop credential and literal local Host.
    """
    history_route = urlsplit(handler.path).path == '/work-history'
    proactive_route = handler.path.startswith('/proactive/')
    if handler.path != "/work" and not handler.path.startswith("/work/") and not history_route and not proactive_route:
        return False
    expected = f"127.0.0.1:{handler.server.server_port}"
    if (handler.headers.get("Host") != expected
            or handler.headers.get("Origin", f"http://{expected}") != f"http://{expected}"
            or handler.headers.get("Sec-Fetch-Site", "same-origin") not in {"same-origin", "none"}):
        handler.reply(403, {"error": "local_origin_required"})
        return True
    if not hmac.compare_digest(handler.headers.get("Authorization", ""), "Bearer " + token):
        if gateway is not None:
            from bus import AgentName, Message
            gateway.sentinel.log(Message(AgentName.ARCHITECT, AgentName(worker.knight), "desktop_work"), "unauthorized")
        handler.reply(401, {"error": "unauthorized"})
        return True
    if worker.knight != "architect":
        handler.reply(404, {"error": "architect_work_route_required"})
        return True
    manager = getattr(gateway, "work_sessions", None)
    if manager is None:
        handler.reply(503, {"error": "work_service_unavailable"})
        return True
    proactive = getattr(gateway, 'proactive_routines', None)
    if proactive_route and proactive is None:
        handler.reply(503, {'error': 'proactive_service_unavailable'})
        return True
    future = None
    try:
        match = _TASK_PATH.fullmatch(handler.path)
        artifact_match = _ARTIFACT_PATH.fullmatch(handler.path)
        if artifact_match and handler.command != 'GET':
            handler.reply(405, {'error': 'method_not_allowed'})
            return True
        if history_route and handler.command != 'GET':
            handler.reply(405, {'error': 'method_not_allowed'})
            return True
        if handler.command == "GET":
            if handler.path == '/proactive/routines':
                operation = None
                result = proactive.status()
                code = 200
            elif history_route:
                query = parse_qs(urlsplit(handler.path).query, keep_blank_values=True, strict_parsing=True, max_num_fields=2)
                if set(query) - {'limit', 'cursor'} or any(len(values) != 1 for values in query.values()):
                    raise ValueError('Invalid history query')
                limit = query.get('limit', ['40'])[0]
                if not re.fullmatch(r'[0-9]{1,3}', limit) or not 1 <= int(limit) <= 100:
                    raise ValueError('Invalid history limit')
                operation = manager.history(token, limit=int(limit), cursor=query.get('cursor', [None])[0])
            elif handler.path == "/work":
                operation = manager.list(token)
            elif artifact_match:
                operation = (manager.artifacts(artifact_match[1], token) if artifact_match[2] is None
                             else manager.download_artifact(artifact_match[1], int(artifact_match[2]),
                                                            artifact_match[3], token))
            elif match and not match[2]:
                operation = manager.get(match[1], token)
            else:
                handler.reply(404, {"error": "not_found"})
                return True
            code = 200
        elif handler.command == "POST":
            if handler.headers.get("Transfer-Encoding") is not None:
                raise ValueError("transfer_encoding_not_supported")
            if handler.headers.get_content_type() != "application/json":
                raise ValueError("json_body_required")
            lengths = handler.headers.get_all("Content-Length", [])
            if len(lengths) != 1 or not lengths[0].isascii() or not lengths[0].isdigit():
                raise ValueError("invalid_content_length")
            length = int(lengths[0])
            if not 0 < length <= 65536:
                handler.reply(413, {"error": "invalid_body_size"})
                return True
            body = json.loads(handler.rfile.read(length))
            if not isinstance(body, dict):
                raise ValueError("object_required")
            if handler.path == '/proactive/grants':
                if not {'label'} <= set(body) <= {'label', 'max_fires'}:
                    raise ValueError('invalid_grant_request')
                operation = None
                result = proactive.create_grant(body['label'], max_fires=body.get('max_fires'))
                _audit_proactive(gateway, 'proactive_grant_create')
                code = 201
            elif handler.path == '/proactive/monitors':
                required = {'goal', 'sensor_type', 'sensor_id', 'field', 'operator', 'threshold',
                            'interval_seconds', 'cooldown_seconds', 'grant_id'}
                if set(body) != required:
                    raise ValueError('invalid_monitor_request')
                operation = None
                result = proactive.create_monitor(**body)
                _audit_proactive(gateway, 'proactive_monitor_create')
                code = 201
            elif handler.path == '/proactive/routines':
                if set(body) != {'goal', 'interval_seconds', 'grant_id'}:
                    raise ValueError('invalid_routine_request')
                operation = None
                result = proactive.create_routine(body['goal'], body['interval_seconds'], body['grant_id'])
                _audit_proactive(gateway, 'proactive_routine_create')
                code = 201
            elif (routine_match := _ROUTINE_PATH.fullmatch(handler.path)) and routine_match[1] and not body:
                operation = None
                result = proactive.disable_routine(routine_match[1])
                _audit_proactive(gateway, 'proactive_routine_disable')
                code = 200
            elif (monitor_match := _MONITOR_PATH.fullmatch(handler.path)) and monitor_match[1] and not body:
                operation = None
                result = proactive.disable_monitor(monitor_match[1])
                _audit_proactive(gateway, 'proactive_monitor_disable')
                code = 200
            elif handler.path == "/work":
                if not {"goal"} <= set(body) <= {"goal", "conversation_id", "request_id"}:
                    raise ValueError("invalid_work_request")
                operation = manager.create(body["goal"], token,
                                           conversation_id=body.get("conversation_id"),
                                           request_id=body.get("request_id"))
                code = 202
            elif match and match[2] and not body:
                operation = (manager.cancel(match[1], token) if match[2] == "/cancel"
                             else manager.resume(match[1], token))
                code = 200
            else:
                handler.reply(404, {"error": "not_found"})
                return True
        else:
            handler.reply(405, {"error": "method_not_allowed"})
            return True
        if operation is not None:
            future = asyncio.run_coroutine_threadsafe(operation, gateway.loop)
            result = future.result(timeout=15)
        if handler.command == "GET" and handler.path == "/work" and isinstance(result, list):
            result = {"tasks": result}
        handler.reply(code, result)
    except ArtifactAccessError as error:
        handler.reply(error.status, {'error': error.code})
    except NativeTaskQualificationError as error:
        handler.reply(503, {'error': 'native_task_execution_unqualified',
                            'message': str(error), 'task_started': False})
    except PermissionError:
        handler.reply(403, {"error": "sentinel_denied"})
    except KeyError:
        handler.reply(404, {"error": "task_not_found"})
    except (ValueError, TypeError, UnicodeError):
        handler.reply(400, {"error": "invalid_work_request"})
    except TimeoutError:
        # A client retries with the same request_id; never enqueue another goal here.
        handler.reply(504, {"error": "work_service_timeout"})
    except Exception:
        handler.reply(503, {"error": "work_service_failed"})
    return True
