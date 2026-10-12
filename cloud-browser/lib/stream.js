// يشغّل ffmpeg: يلتقط الشاشة (x11grab) والصوت (PulseAudio) ويرمّزهما H.264 + Opus
// ويخرج fragmented MP4 إلى stdout، ليرسله السيرفر عبر WebSocket.
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

export function buildFfmpegArgs({ profile, audioCodec = 'opus', captureMode = 'x11', display, screen, pulseSource }) {
  const fps = profile.fps;
  const gop = fps * 2; // مفتاح كل ثانيتين
  const kbps = profile.videoKbps;
  const aKbps = profile.audioKbps;

  const input = captureMode === 'test'
    ? ['-f', 'lavfi', '-re', '-i', `testsrc2=size=${screen.width}x${screen.height}:rate=${fps}`,
       '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000']
    : ['-f', 'x11grab', '-framerate', String(fps), '-video_size', `${screen.width}x${screen.height}`,
       '-draw_mouse', '0', '-i', display,
       '-f', 'pulse', '-i', pulseSource];

  const audioEnc = audioCodec === 'aac'
    ? ['-c:a', 'aac', '-b:a', `${aKbps}k`]
    : ['-c:a', 'libopus', '-b:a', `${aKbps}k`, '-application', 'voip'];

  return [
    '-hide_banner', '-loglevel', 'warning', '-nostdin',
    ...input,
    '-map', '0:v:0', '-map', '1:a:0',
    '-vf', `fps=${fps},scale=${profile.width}:${profile.height}:flags=bicubic,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
    '-profile:v', 'baseline', '-level', profile.level,
    '-b:v', `${kbps}k`, '-maxrate', `${kbps}k`, '-bufsize', `${kbps}k`,
    '-x264-params', 'nal-hrd=cbr:force-cfr=1',
    '-g', String(gop), '-keyint_min', String(fps),
    ...audioEnc, '-ac', '1', '-ar', '48000',
    '-f', 'mp4',
    '-movflags', 'empty_moov+default_base_moof+frag_keyframe',
    'pipe:1',
  ];
}

export class StreamProcess extends EventEmitter {
  constructor(opts) {
    super();
    this.opts = opts;
    this.proc = null;
    this.stderrTail = [];
    this.stopping = false;
  }

  start() {
    const args = buildFfmpegArgs(this.opts);
    this.proc = spawn(this.opts.ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc.stdout.on('data', (chunk) => this.emit('data', chunk));
    this.proc.stderr.on('data', (d) => {
      const lines = d.toString().split('\n').filter(Boolean);
      this.stderrTail.push(...lines);
      if (this.stderrTail.length > 30) this.stderrTail.splice(0, this.stderrTail.length - 30);
    });
    this.proc.on('error', (err) => this.emit('error', err));
    this.proc.on('exit', (code, signal) => {
      this.proc = null;
      this.emit('exit', { code, signal, stopping: this.stopping, stderr: this.stderrTail.slice(-5) });
    });
    return this;
  }

  stop() {
    this.stopping = true;
    if (this.proc) {
      this.proc.kill('SIGTERM');
      const p = this.proc;
      setTimeout(() => { if (p.exitCode === null && p.signalCode === null) p.kill('SIGKILL'); }, 2000).unref();
    }
  }
}
