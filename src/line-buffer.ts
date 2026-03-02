export class LineBuffer {
  private partial = ''

  push(chunk: string): string[] {
    this.partial += chunk
    const parts = this.partial.split('\n')
    this.partial = parts.pop()!
    return parts
  }

  flush(): string[] {
    if (this.partial) {
      const last = this.partial
      this.partial = ''
      return [last]
    }
    return []
  }
}
