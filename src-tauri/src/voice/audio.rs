use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::collections::VecDeque;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    mpsc::SyncSender,
    Arc,
};

pub const RATE: usize = 16_000;
const FRAME: usize = 320; // 20 ms, mono PCM16

pub enum Audio {
    Frame(Vec<i16>),
    Error,
}

/// Capture never performs recognition, blocks, writes files or accesses the network.
pub fn capture(tx: SyncSender<Audio>, overflow: Arc<AtomicBool>) -> Result<cpal::Stream, String> {
    let device = cpal::default_host()
        .default_input_device()
        .ok_or("Mikrofon bulunamadı.")?;
    let format = device
        .default_input_config()
        .map_err(|e| format!("Mikrofon açılamadı: {e}"))?;
    let config: cpal::StreamConfig = format.clone().into();
    macro_rules! stream {
        ($ty:ty, $convert:expr) => {{
            let mut sampler = Sampler::new(config.sample_rate.0, config.channels as usize);
            let errors = tx.clone();
            device.build_input_stream(
                &config,
                move |data: &[$ty], _| {
                    for sample in data {
                        if let Some(frame) = sampler.push(($convert)(*sample)) {
                            if tx.try_send(Audio::Frame(frame)).is_err() {
                                overflow.store(true, Ordering::Relaxed);
                            }
                        }
                    }
                },
                move |_| {
                    let _ = errors.try_send(Audio::Error);
                },
                None,
            )
        }};
    }
    let stream = match format.sample_format() {
        cpal::SampleFormat::F32 => stream!(f32, |s: f32| s),
        cpal::SampleFormat::I16 => stream!(i16, |s: i16| s as f32 / 32768.0),
        cpal::SampleFormat::U16 => stream!(u16, |s: u16| (s as f32 - 32768.0) / 32768.0),
        other => return Err(format!("Desteklenmeyen mikrofon biçimi: {other}")),
    }
    .map_err(|e| format!("Mikrofon iznini ve giriş aygıtını kontrol et: {e}"))?;
    stream
        .play()
        .map_err(|e| format!("Mikrofon başlatılamadı: {e}"))?;
    Ok(stream)
}

/// Low-pass averaging downsampler with phase preserved across callback boundaries.
struct Sampler {
    rate: u32,
    channels: usize,
    channel: usize,
    mono: f32,
    phase: u32,
    sum: f32,
    count: u32,
    frame: Vec<i16>,
}
impl Sampler {
    fn new(rate: u32, channels: usize) -> Self {
        Self {
            rate,
            channels,
            channel: 0,
            mono: 0.0,
            phase: 0,
            sum: 0.0,
            count: 0,
            frame: Vec::with_capacity(FRAME),
        }
    }
    fn push(&mut self, sample: f32) -> Option<Vec<i16>> {
        self.mono += if sample.is_finite() { sample } else { 0.0 };
        self.channel += 1;
        if self.channel != self.channels {
            return None;
        }
        self.sum += self.mono / self.channels as f32;
        self.count += 1;
        self.mono = 0.0;
        self.channel = 0;
        self.phase += RATE as u32;
        while self.phase >= self.rate {
            self.phase -= self.rate;
            self.frame
                .push(((self.sum / self.count as f32).clamp(-1.0, 1.0) * 32767.0) as i16);
        }
        if self.frame.len() >= FRAME {
            let frame = std::mem::replace(&mut self.frame, Vec::with_capacity(FRAME));
            self.sum = 0.0;
            self.count = 0;
            return Some(frame);
        }
        if self.phase < RATE as u32 {
            self.sum = 0.0;
            self.count = 0;
        }
        None
    }
}

/// Bounded voice activity gate. Silence costs RMS calculation only; the decoder
/// receives a completed short utterance once, including 200 ms of pre-roll.
pub struct Gate {
    pre: VecDeque<i16>,
    speech: Vec<i16>,
    quiet: usize,
    voiced: usize,
    active: bool,
    discard: bool,
    noise: f32,
}
impl Default for Gate {
    fn default() -> Self {
        Self {
            pre: VecDeque::with_capacity(3200),
            speech: Vec::with_capacity(RATE * 4),
            quiet: 0,
            voiced: 0,
            active: false,
            discard: false,
            noise: 60.0,
        }
    }
}
impl Gate {
    pub fn push(&mut self, frame: &[i16]) -> Option<Vec<i16>> {
        if frame.is_empty() {
            return None;
        }
        let rms =
            (frame.iter().map(|s| (*s as f32).powi(2)).sum::<f32>() / frame.len() as f32).sqrt();
        let loud = rms > (self.noise * 3.0).max(180.0);
        if !self.active {
            if !loud {
                self.noise = self.noise * 0.98 + rms.min(350.0) * 0.02;
            }
            self.voiced = if loud { self.voiced + frame.len() } else { 0 };
            self.pre.extend(frame);
            while self.pre.len() > RATE / 5 {
                self.pre.pop_front();
            }
            if self.voiced < RATE / 25 {
                return None;
            }
            self.active = true;
            self.quiet = 0;
            self.speech.extend(self.pre.drain(..));
            return None;
        }
        self.quiet = if loud { 0 } else { self.quiet + frame.len() };
        if !self.discard {
            self.speech.extend_from_slice(frame);
        }
        if self.speech.len() > RATE * 4 {
            self.speech.clear();
            self.discard = true;
        }
        if self.quiet < RATE / 2 {
            return None;
        }
        let accepted = !self.discard && self.speech.len() >= RATE / 5 + self.quiet;
        let result = if accepted {
            Some(std::mem::replace(
                &mut self.speech,
                Vec::with_capacity(RATE * 4),
            ))
        } else {
            self.speech.clear();
            None
        };
        self.active = false;
        self.discard = false;
        self.quiet = 0;
        self.voiced = 0;
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn silence_never_invokes_decoder() {
        let mut gate = Gate::default();
        for _ in 0..3000 {
            assert!(gate.push(&[0; FRAME]).is_none());
        }
    }
    #[test]
    fn short_speech_is_emitted_once_and_long_speech_is_discarded() {
        let mut gate = Gate::default();
        let mut outputs = 0;
        for _ in 0..25 {
            assert!(gate.push(&[2500; FRAME]).is_none());
        }
        for _ in 0..80 {
            if gate.push(&[0; FRAME]).is_some() {
                outputs += 1;
            }
        }
        assert_eq!(outputs, 1);
        for _ in 0..300 {
            assert!(gate.push(&[2500; FRAME]).is_none());
        }
        for _ in 0..80 {
            assert!(gate.push(&[0; FRAME]).is_none());
        }
    }
    #[test]
    fn sampler_preserves_rate_channels_and_frame_boundaries() {
        for rate in [16000, 44100, 48000] {
            let mut sampler = Sampler::new(rate, 2);
            let mut count = 0;
            for _ in 0..rate {
                for _ in 0..2 {
                    if let Some(frame) = sampler.push(0.5) {
                        count += frame.len();
                        assert!(frame.iter().all(|s| (s - 16383).abs() <= 1));
                    }
                }
            }
            assert_eq!(count, RATE, "{rate}");
        }
    }
}
