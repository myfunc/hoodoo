import { describe, expect, it } from 'vitest';
import { SOFTWARE_GPU, gpuLabel } from '../gpu/gpu-name';

describe('gpuLabel', () => {
  it('names the GPU behind ANGLE on Windows, without ids and shader models', () => {
    expect(gpuLabel('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('Intel Iris Xe Graphics');
    expect(gpuLabel('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU (0x00002520) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('NVIDIA GeForce RTX 3060 Laptop GPU');
  });

  it('names Apple GPUs behind ANGLE Metal, and keeps a plain name as it is', () => {
    expect(gpuLabel('ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro, Unspecified Version)')).toBe('Apple M4 Pro');
    expect(gpuLabel('Apple GPU')).toBe('Apple GPU');
  });

  it('says so when the browser draws in software', () => {
    expect(gpuLabel('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)')).toBe(SOFTWARE_GPU);
    expect(gpuLabel('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(SOFTWARE_GPU);
  });
});
