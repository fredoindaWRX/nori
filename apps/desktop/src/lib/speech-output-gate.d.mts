type Speaker = {
  say(text: string): void
  push(text: string): void
  end(): Promise<void>
  cancel(): void
  level(): number
}
export function createSpeechOutputGate(): {
  enabled(): boolean
  setEnabled(value: boolean): boolean
  create(factory: () => Speaker): Speaker
}
