"""Desktop tool inventory. Availability is not a claim of successful execution."""

try:
    from .editor_stack import editor_status
except ImportError:  # Direct-script compatibility for legacy callers.
    from editor_stack import editor_status


def inventory(isolated_runner=False):
    return {
        'status':'completed',
        'scope':'Current desktop work-session actions; connected services must still return successful results.',
        'layers': {
            'read': {'actions':['read_file','read_previous','project_read','project_search','downloads_search','knowledge_search','inspect_web','research_health','research_report','google_status','gmail_list','gmail_read','calendar_list','find_skills','home_status','home_get_state','tool_bridge_status','tool_bridge_list_tools'],
                     'isolated_actions':['read_document','query_database'],
                     'limitations':['Knowledge requires indexed documents.','Public web reads require approved transport.','Document and SQLite imports accept Downloads files up to 512 KB.']},
            'write_act': {'actions':['write_file','edit_file','project_stage','project_apply','project_rollback','save_generated_output','create_skill','home_set_light','home_set_switch','home_vacuum_command','tool_bridge_call'], 'isolated_actions':['run_python','run_tests','run_pytest','run_saved_skill'],
                          'limitations':['Tested projects/ changes can be applied with backup and rollback; platform source remains staged.','No host software installation or interactive browser action.']},
            'communicate': {'actions':['owner_task_events','owner_final_response','gmail_draft','draft_email','draft_calendar'],
                            'limitations':['Outbound email, SMS, Slack, CMS and CRM adapters are not connected through this desktop loop.']},
            'analyze': {'actions':['analyze_csv'], 'isolated_actions':['run_python','query_database'],
                        'provisioned_desktop_packages':['numpy','pandas','matplotlib','plotly','openpyxl','pypdf'],
                        'limitations':['Export requires recorded successful stdout in the documented base64 envelope; PNG/TXT/CSV/JSON only, 90 KB maximum. PNG structure verification is not visual accuracy verification.','Installed packages must be tested in the running backend.']}
        },
        'isolated_runner_configured':bool(isolated_runner),
        'isolated_execution_qualification': {
            'status':'not_evaluated' if isolated_runner else 'unavailable',
            'configured':bool(isolated_runner),
            'ready_verified':False,
            'limitations':['A configuration object does not prove a usable sandbox.',
                           'Runtime startup, isolation, resource limits and cleanup require real backend acceptance.']
        },
        'skill_reuse': {'discovery':'Completed prior tasks with matching artifact and successful test hashes.',
                       'execution':'Tests rerun before run(parameters), exclusively in the isolated Python runner.',
                       'limitations':['No host plugin activation or additional permissions.','Passing authored tests does not prove every input is correct.']},
        'observability':{'backend':'local SQLite and work-session records','fields':['request_id','knight','operation','outcome','duration_ms'],
                         'limitations':['No complete token-cost accounting or external Langfuse/LangSmith exporter.']},
        'google_integration':{'adapter':'typed Gmail list/read, local unsent draft, and Calendar list operations implemented',
                              'connection':'Use google_status; OAuth client, explicit owner consent and approved transport required.',
                              'writes':'No Gmail send, hosted draft, or Calendar mutation.'},
        'home_integration':{'adapter':'typed local Home Assistant status, entity read, and verified light/switch/vacuum control through Tank',
                            'connection':'Owner enrollment is required; credentials are not returned by status or task results.',
                              'writes':'Light, switch, and vacuum actions require a successful post-action state readback.'},
        'tool_bridge_integration':{'adapter':'owner-configured local OpenClaw/MCP-compatible bridge through Tank',
                                   'connection':'Use tool_bridge_status and tool_bridge_list_tools; endpoint must be local or Tailscale-verified and trusted.',
                                   'writes':'tool_bridge_call can only call owner-allowlisted bridge tools, with read and act grants separated.'},
        'editor_stack': editor_status(),
        'external_integrations_pending':['SendGrid','Twilio','Slack','Stripe','HubSpot','Google Analytics','Search Console','Notion','Shopify','WordPress','QuickBooks','Xero','Semrush','Ahrefs','LinkedIn','GitHub','Linear','Intercom'],
        'next_step':'Use available actions first; for unimplemented adapters, report the exact missing integration and build/test a staged adapter when feasible.'
    }

