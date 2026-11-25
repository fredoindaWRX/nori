def contradictory_block_reason(text):
    text = text.lower()
    if 'the task was already completed' in text:
        return 'The task was already completed'
    if 'no remaining work' in text or 'nothing left to do' in text:
        return 'No remaining work/nothing left to do'
    return None