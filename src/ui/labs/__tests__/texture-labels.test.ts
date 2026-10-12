import { describe, expect, it } from 'vitest';
import { material } from '../../../model/material.factory';
import { ChannelSource, ColorChannel, ValueChannel } from '../../../model/scene.enums';
import { channelsFrom, sourceOf, withSource, withoutSource } from '../texture-labels';

describe('texture slots of a material', () => {
  it('name the channels each slot drives and switch one at a time', () => {
    const m = withSource(withSource(material({ name: 'Test' }), ColorChannel.Diffuse, ChannelSource.TexB), ValueChannel.Bump, ChannelSource.TexB);
    expect(channelsFrom(m, ChannelSource.TexB)).toEqual([ColorChannel.Diffuse, ValueChannel.Bump]);
    expect(channelsFrom(m, ChannelSource.TexC)).toEqual([]);
    expect(sourceOf(m, ValueChannel.Bump)).toBe(ChannelSource.TexB);
    expect(sourceOf(m, ColorChannel.Ambient)).toBe(ChannelSource.Flat);
  });

  it('send the channels of an emptied slot back to their flat values', () => {
    const m = withSource(withSource(material({ name: 'Test' }), ColorChannel.Diffuse, ChannelSource.TexB), ValueChannel.Bump, ChannelSource.TexA);
    const out = withoutSource(m, ChannelSource.TexB);
    expect(sourceOf(out, ColorChannel.Diffuse)).toBe(ChannelSource.Flat);
    expect(sourceOf(out, ValueChannel.Bump)).toBe(ChannelSource.TexA);
  });
});
