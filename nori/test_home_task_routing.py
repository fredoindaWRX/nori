from desktop_task_graph import validate


def node(task, worker="trinity", verify="answer"):
    return {"id": "one", "worker": worker, "model_tier": "general_8b", "task": task,
            "depends_on": [], "verify": verify}


def test_light_control_is_forced_to_tank_tool_evidence():
    result = validate([node("Turn on the kitchen light at fifty percent")])[0]
    assert result["worker"] == "tank"
    assert result["required_operation"] == "home_set_light"
    assert result["verify"] == "tool"
    assert result["task"].startswith("Use home_set_light")


def test_light_state_query_is_forced_to_tank_read():
    result = validate([node("What is the state of the office light?")])[0]
    assert result["worker"] == "tank"
    assert result["required_operation"] == "home_get_state"
    assert result["verify"] == "tool"


def test_switch_or_kettle_control_is_forced_to_tank_tool_evidence():
    result = validate([node("Turn on the kettle switch")])[0]
    assert result["worker"] == "tank"
    assert result["required_operation"] == "home_set_switch"
    assert result["verify"] == "tool"

def test_vacuum_control_is_forced_to_tank_tool_evidence():
    result = validate([node("Start the vacuum cleaner in the living room")])[0]
    assert result["worker"] == "tank"
    assert result["required_operation"] == "home_vacuum_command"
    assert result["verify"] == "tool"
    assert result["task"].startswith("Use home_vacuum_command")


def test_vacuum_dock_is_forced_to_tank_tool_evidence():
    result = validate([node("Send the robot vacuum to dock")])[0]
    assert result["worker"] == "tank"
    assert result["required_operation"] == "home_vacuum_command"
    assert result["verify"] == "tool"


def test_vacuum_state_query_is_forced_to_tank_read():
    result = validate([node("What is the status of the robot vacuum?")])[0]
    assert result["worker"] == "tank"
    assert result["required_operation"] == "home_get_state"
    assert result["verify"] == "tool"

