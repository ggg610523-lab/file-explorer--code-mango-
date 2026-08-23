type Task = () => void;

export class Scheduler {
  private high: Task[] = [];
  private low: Task[] = [];
  private raf = 0;
  private idleId: number | null = null;

  highPri(fn: Task): void {
    this.high.push(fn);
    if (!this.raf) this.raf = requestAnimationFrame(() => this.flushHigh());
  }

  lowPri(fn: Task): void {
    this.low.push(fn);
    if (this.idleId === null) {
      this.idleId = requestIdleCallback
        ? requestIdleCallback((dl) => this.flushLow(dl))
        : (setTimeout as any)(() => this.flushLow({ timeRemaining: () => 50 } as IdleDeadline), 50);
    }
  }

  private flushHigh(): void {
    this.raf = 0;
    const fns = this.high;
    this.high = [];
    for (const fn of fns) fn();
  }

  private flushLow(deadline: IdleDeadline): void {
    this.idleId = null;
    while (this.low.length > 0 && deadline.timeRemaining() > 0) {
      this.low.shift()!();
    }
    if (this.low.length > 0) this.idleId = requestIdleCallback((dl) => this.flushLow(dl));
  }
}

export class FpsDebug {
  private el: HTMLDivElement;
  private frames = 0;
  private lastTime = performance.now();
  private raf = 0;
  private visible = false;
  private avgFps = 0;
  private samples: number[] = [];

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'fps-debug';
    Object.assign(this.el.style, {
      position: 'fixed', bottom: '8px', right: '8px', zIndex: '9999',
      background: 'rgba(0,0,0,0.75)', color: '#0f0', padding: '4px 10px',
      borderRadius: '6px', font: '11px/1.4 monospace', display: 'none',
      pointerEvents: 'none', userSelect: 'none', whiteSpace: 'pre',
    });
    document.body.appendChild(this.el);
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'F3') { this.toggle(); e.preventDefault(); }
    });
  }

  private toggle(): void {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? 'block' : 'none';
    if (this.visible) this.start();
    else this.stop();
  }

  private start(): void {
    const tick = () => {
      this.frames++;
      const now = performance.now();
      const dt = now - this.lastTime;
      if (dt >= 500) {
        const fps = (this.frames / dt) * 1000;
        this.samples.push(fps);
        if (this.samples.length > 60) this.samples.shift();
        this.avgFps = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
        const mem = (performance as any).memory;
        this.el.textContent =
          `FPS: ${fps.toFixed(1)}\n` +
          `Avg: ${this.avgFps.toFixed(1)}\n` +
          (mem ? `Mem: ${(mem.usedJSHeapSize / 1048576).toFixed(1)} MB` : '');
        this.frames = 0;
        this.lastTime = now;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.lastTime = performance.now();
    this.frames = 0;
    this.raf = requestAnimationFrame(tick);
  }

  private stop(): void {
    cancelAnimationFrame(this.raf);
    this.el.textContent = '';
  }
}
