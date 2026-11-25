"""CrewAI goal planning with validated dependency graphs."""
from dataclasses import dataclass, field
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]

@dataclass(frozen=True)
class Subtask:
    id: str
    description: str
    capability: str
    request: dict
    depends_on: tuple[str, ...] = ()
    retry_safe: bool = False

class TaskDecomposer:
    def __init__(self, planner=None, model=None, base_url="http://127.0.0.1:11434", llm=None):
        model=model or "ollama/"+json.loads((ROOT/"config.yaml").read_text())["knights"]["architect"]["model"]
        self.planner, self.model, self.base_url = planner, model, base_url
        self.llm = llm

    def decompose(self, goal, contracts):
        if not isinstance(goal, str) or not goal.strip():
            raise ValueError("A nonempty owner goal is required")
        if self.planner:
            raw = self.planner(goal, contracts)
        else:
            from crewai import Agent, Task, Crew, LLM
            llm = self.llm or LLM(model=self.model, base_url=self.base_url)
            agent = Agent(role="NORI Architect", goal="Decompose owner goals into executable Knight tasks",
                backstory=(Path(__file__).resolve().parents[1]/"prompts/architect.md").read_text(),
                llm=llm, allow_delegation=False, verbose=False, max_iter=3)
            task = Task(agent=agent, description=(
                "Plan this owner goal: " + goal + "\nAvailable contracts: " + json.dumps(contracts) +
                '\nReturn a JSON array of tasks with id, description, capability, request, depends_on, retry_safe. '
                'Use dependencies for ordering and shared writes. Split independent work into separate tasks. '
                'retry_safe must be false for changes that could be duplicated. Maximum 64 tasks.'),
                expected_output="A JSON array only, no markdown")
            raw = Crew(agents=[agent], tasks=[task], verbose=False, tracing=False).kickoff().raw
        if isinstance(raw, str):
            raw = json.loads(raw)
        return self.validate(raw, contracts)

    @staticmethod
    def validate(raw, contracts):
        if not isinstance(raw, list) or not 1 <= len(raw) <= 64:
            raise ValueError("Plan must contain 1 to 64 tasks")
        tasks = []
        for item in raw:
            if not isinstance(item, dict) or set(item) - {"id", "description", "capability", "request", "depends_on", "retry_safe"}:
                raise ValueError("Invalid task fields")
            for key in ("id", "description", "capability"):
                if not isinstance(item.get(key), str) or not item[key].strip():
                    raise ValueError("Missing task identity or capability")
            deps = item.get("depends_on", [])
            if not isinstance(deps, list) or any(not isinstance(d, str) for d in deps):
                raise ValueError("Invalid dependencies")
            if not isinstance(item.get("request"), dict) or type(item.get("retry_safe", False)) is not bool:
                raise ValueError("Invalid request or retry policy")
            if item["capability"] not in contracts:
                raise ValueError("Unsupported capability")
            tasks.append(Subtask(item["id"], item["description"], item["capability"], item["request"], tuple(deps), item.get("retry_safe", False)))
        ids = {t.id for t in tasks}
        if len(ids) != len(tasks) or any(d not in ids for t in tasks for d in t.depends_on):
            raise ValueError("Duplicate IDs or unknown dependencies")
        done = set()
        while len(done) < len(tasks):
            ready = {t.id for t in tasks if t.id not in done and set(t.depends_on) <= done}
            if not ready:
                raise ValueError("Cyclic dependencies")
            done.update(ready)
        return tasks
