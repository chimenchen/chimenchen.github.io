/*
 * Copyright (C) 2014-2017 Eitan Isaacson
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, see: <http://www.gnu.org/licenses/>.
 */

/* An audio node that can have audio chunks pushed to it */

function PushAudioNode(context, start_callback, end_callback, buffer_size) {
  this.context = context;
  this.start_callback = start_callback;
  this.end_callback = end_callback;
  this.buffer_size = buffer_size || 4096;
  this.samples_queue = [];
  this.scriptNode = context.createScriptProcessor(this.buffer_size, 1, 1);
  this.connected = false;
  this.sinks = [];
  this.startTime = 0;
  this.closed = false;
  this.track_callbacks = new Map();
}

PushAudioNode.prototype.push = function (chunk) {
  if (this.closed) {
    throw 'Cannot push more chunks after node was closed';
  }
  this.samples_queue.push(chunk);
  if (!this.connected) {
    if (!this.sinks.length) {
      throw 'No destination set for PushAudioNode';
    }
    this._do_connect();
  }
}

PushAudioNode.prototype.close = function () {
  this.closed = true;
}

PushAudioNode.prototype.connect = function (dest) {
  this.sinks.push(dest);
  if (this.samples_queue.length) {
    this._do_connect();
  }
}

PushAudioNode.prototype._do_connect = function () {
  if (this.connected) return;
  this.connected = true;
  for (var dest of this.sinks) {
    this.scriptNode.connect(dest);
  }
  this.scriptNode.onaudioprocess = this.handleEvent.bind(this);
}

PushAudioNode.prototype.disconnect = function () {
  this.scriptNode.onaudioprocess = null;
  this.scriptNode.disconnect();
  this.connected = false;
}

PushAudioNode.prototype.addTrackCallback = function (aTimestamp, aCallback) {
  var callbacks = this.track_callbacks.get(aTimestamp) || [];
  callbacks.push(aCallback);
  this.track_callbacks.set(aTimestamp, callbacks);
}

PushAudioNode.prototype.handleEvent = function (evt) {
  if (!this.startTime) {
    this.startTime = evt.playbackTime;
    if (this.start_callback) {
      this.start_callback();
    }
  }

  var currentTime = evt.playbackTime - this.startTime;
  var playbackDuration = this.scriptNode.bufferSize / this.context.sampleRate;
  for (var entry of this.track_callbacks) {
    var timestamp = entry[0];
    var callbacks = entry[1];
    if (timestamp < currentTime) {
      this.track_callbacks.delete(timestamp);
    } else if (timestamp < currentTime + playbackDuration) {
      for (var cb of callbacks) {
        cb();
      }
      this.track_callbacks.delete(timestamp);
    }
  }

  var offset = 0;
  while (this.samples_queue.length && offset < evt.target.bufferSize) {
    var chunk = this.samples_queue[0];
    var to_copy = chunk.subarray(0, evt.target.bufferSize - offset);
    if (evt.outputBuffer.copyToChannel) {
      evt.outputBuffer.copyToChannel(to_copy, 0, offset);
    } else {
      evt.outputBuffer.getChannelData(0).set(to_copy, offset);
    }
    offset += to_copy.length;
    chunk = chunk.subarray(to_copy.length);
    if (chunk.length)
      this.samples_queue[0] = chunk;
    else
      this.samples_queue.shift();
  }

  if (!this.samples_queue.length && this.closed) {
    if (this.end_callback) {
      this.end_callback(evt.playbackTime - this.startTime);
    }
    this.disconnect();
  }
}



/* Code specific to the demo */

// var ctx = new (window.AudioContext || window.webkitAudioContext)();
var tts;
var pusher;
var pusher_buffer_size = 4096;
var chunkID = 0;

(function (window) {
  'use strict';

  class ZhongwenSpeech {
    constructor() {
      // 延遲創建 AudioContext，等待用戶交互
      this.ctx = null;  // new (window.AudioContext || window.webkitAudioContext)();
      this.tts = null;
      this.pusher = null;
      this.pusher_buffer_size = 4096;
      this.chunkID = 0;
      this.recordedChunks = [];
      this.latestAudioUrl = null;
      this.latestAudioBlob = null;
      this.latestAudioFilename = null;
      this.downloadingAnchor = null;
      this.filenamePrefix = 'espeak';
    }

    dispatchAudioReset() {
      window.dispatchEvent(new CustomEvent('espeak-audio-reset'));
    }

    beginSynthesisSession() {
      this.releaseLatestAudioUrl();
      this.latestAudioBlob = null;
      this.latestAudioFilename = null;
      this.recordedChunks = [];
      this.dispatchAudioReset();
    }

    releaseLatestAudioUrl() {
      if (this.latestAudioUrl) {
        URL.revokeObjectURL(this.latestAudioUrl);
        this.latestAudioUrl = null;
      }
    }

    setFilenamePrefix(prefix) {
      if (typeof prefix !== 'string') {
        this.filenamePrefix = 'espeak';
        return;
      }
      const trimmed = prefix.trim();
      if (!trimmed) {
        this.filenamePrefix = 'espeak';
        return;
      }
      const sanitized = trimmed
        .replace(/[\\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, '_')
        .slice(0, 60);
      this.filenamePrefix = sanitized || 'espeak';
    }

    buildAudioFilename() {
      const now = new Date();
      const pad = (num) => num.toString().padStart(2, '0');
      const prefix = this.filenamePrefix || 'espeak';
      return `${prefix}-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.wav`;
    }

    mergeRecordedChunks() {
      if (!this.recordedChunks.length) {
        return null;
      }
      const totalLength = this.recordedChunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const mergedBuffer = new Float32Array(totalLength);
      let offset = 0;
      for (const chunk of this.recordedChunks) {
        mergedBuffer.set(chunk, offset);
        offset += chunk.length;
      }
      return mergedBuffer;
    }

    encodeWav(samples, sampleRate) {
      const buffer = new ArrayBuffer(44 + samples.length * 2);
      const view = new DataView(buffer);

      const writeString = (offset, string) => {
        for (let i = 0; i < string.length; i++) {
          view.setUint8(offset + i, string.charCodeAt(i));
        }
      };

      const numChannels = 1;
      const bytesPerSample = 2;
      const blockAlign = numChannels * bytesPerSample;

      writeString(0, 'RIFF');
      view.setUint32(4, 36 + samples.length * bytesPerSample, true);
      writeString(8, 'WAVE');
      writeString(12, 'fmt ');
      view.setUint32(16, 16, true); // Subchunk1Size
      view.setUint16(20, 1, true); // PCM format
      view.setUint16(22, numChannels, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * blockAlign, true);
      view.setUint16(32, blockAlign, true);
      view.setUint16(34, 8 * bytesPerSample, true);
      writeString(36, 'data');
      view.setUint32(40, samples.length * bytesPerSample, true);

      let offset = 44;
      for (let i = 0; i < samples.length; i++, offset += 2) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      }

      return buffer;
    }

    finalizeRecording() {
      const merged = this.mergeRecordedChunks();
      this.recordedChunks = [];
      if (!merged) {
        window.dispatchEvent(new CustomEvent('espeak-audio-ready', {
          detail: {
            url: null,
            filename: null,
          }
        }));
        return;
      }
      const sampleRate = this.ctx ? this.ctx.sampleRate : 44100;
      const wavBuffer = this.encodeWav(merged, sampleRate);
      this.latestAudioBlob = new Blob([wavBuffer], { type: 'audio/wav' });
      this.releaseLatestAudioUrl();
      this.latestAudioUrl = URL.createObjectURL(this.latestAudioBlob);
      this.latestAudioFilename = this.buildAudioFilename();

      window.dispatchEvent(new CustomEvent('espeak-audio-ready', {
        detail: {
          url: this.latestAudioUrl,
          filename: this.latestAudioFilename,
        }
      }));
    }

    espeakReplayLastAudio() {
      if (!this.latestAudioUrl) {
        return false;
      }
      const audio = new Audio(this.latestAudioUrl);
      audio.play();
      return true;
    }

    espeakDownloadLastAudio() {
      if (!this.latestAudioUrl) {
        return false;
      }
      const link = this.downloadingAnchor || document.createElement('a');
      link.style.display = 'none';
      link.href = this.latestAudioUrl;
      link.download = this.latestAudioFilename || 'espeak.wav';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      this.downloadingAnchor = link;
      return true;
    }

    appendRecordedSamples(samples) {
      if (!samples) {
        return null;
      }
      let chunk = samples;
      if (!(samples instanceof Float32Array)) {
        chunk = new Float32Array(samples);
      }
      this.recordedChunks.push(chunk);
      return chunk;
    }

    espeakInit() {
      console.log('Creating eSpeakNG instance...');
      this.tts = new eSpeakNG(
        '/js/espeakng.worker.js',
        function cb1() {
          // document.body.classList.remove('loading');
        }
      );
      console.log('Creating eSpeakNG instance... done');
    }

    espeakStopPlay() {
      if (this.pusher) {
        this.pusher.disconnect();
        this.pusher = null;
      }
    }

    initAudioContext() {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      }
      // 如果 context 被暫停，嘗試恢復
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      return this.ctx;
    }

    espeakSpeakText(user_text) {
      this.initAudioContext();

      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      this.espeakStopPlay();
       this.beginSynthesisSession();

      this.tts.set_rate(Number(document.getElementById('rate').value));
      this.tts.set_pitch(Number(document.getElementById('pitch').value));
      this.tts.set_voice(document.getElementById('voice').value);

      // var now = Date.now();
      this.chunkID = 0;

      this.pusher = new PushAudioNode(
        this.ctx,
        () => {
          //console.log('PushAudioNode started!', this.ctx.currentTime, this.pusher.startTime);
        },
        () => {
          //console.log('PushAudioNode ended!', this.ctx.currentTime - this.pusher.startTime);
        },
        this.pusher_buffer_size
      );
      this.pusher.connect(this.ctx.destination);

      // actual synthesis
      this.tts.synthesize(
        user_text,
        (samples, events) => {
          if (!samples) {
            if (this.pusher) {
              this.pusher.close();
            }
            this.finalizeRecording();
            return;
          }
          const chunk = this.appendRecordedSamples(samples);
          if (this.pusher && chunk) {
            this.pusher.push(chunk);
            ++this.chunkID;
          }
        }
      );
    }

    espeakSpeakTextInTextarea() {
      var user_text = document.getElementById('espeakText').value;
      this.espeakSpeakText(user_text);
    }
  }

  // 創建 ZhongwenSpeech 實例
  const zhongwenSpeech = new ZhongwenSpeech();

  // 公開 API
  window.zhongwen = {
    espeakInit: zhongwenSpeech.espeakInit.bind(zhongwenSpeech),
    espeakStopPlay: zhongwenSpeech.espeakStopPlay.bind(zhongwenSpeech),
    espeakSpeakText: zhongwenSpeech.espeakSpeakText.bind(zhongwenSpeech),
    espeakSpeakTextInTextarea: zhongwenSpeech.espeakSpeakTextInTextarea.bind(zhongwenSpeech),
    espeakReplayLastAudio: zhongwenSpeech.espeakReplayLastAudio.bind(zhongwenSpeech),
    espeakDownloadLastAudio: zhongwenSpeech.espeakDownloadLastAudio.bind(zhongwenSpeech),
    espeakSetFilenamePrefix: zhongwenSpeech.setFilenamePrefix.bind(zhongwenSpeech)
  };

  // 為了向後兼容，保留全局函數
  window.espeakInit = window.zhongwen.espeakInit;
  window.espeakSpeakText = window.zhongwen.espeakSpeakText;
  window.espeakSpeakTextInTextarea = window.zhongwen.espeakSpeakTextInTextarea;
  window.espeakStopPlay = window.zhongwen.espeakStopPlay;
  window.espeakReplayLastAudio = window.zhongwen.espeakReplayLastAudio;
  window.espeakDownloadLastAudio = window.zhongwen.espeakDownloadLastAudio;
  window.espeakSetFilenamePrefix = window.zhongwen.espeakSetFilenamePrefix;

})(window);
