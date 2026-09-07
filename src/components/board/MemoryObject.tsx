import { useEffect, useState } from 'react';
import type { Memory } from '../../lib/types';
import { Frame } from '../frames/Frame';
import { HandNote, LabelTag, Postcard, StickyNote, Ticket } from '../objects/PaperObjects';
import { cachedAssetUrl, resolveAsset } from '../../lib/storage';

/** Resolves an uploaded asset (IndexedDB blob) or a direct demo image URL. */
export function useAssetUrl(memory: Pick<Memory, 'assetId' | 'imageUrl'>): string | undefined {
  const [url, setUrl] = useState<string | undefined>(
    () => memory.imageUrl ?? (memory.assetId ? cachedAssetUrl(memory.assetId) : undefined),
  );

  useEffect(() => {
    if (memory.imageUrl) {
      setUrl(memory.imageUrl);
      return;
    }
    if (!memory.assetId) {
      setUrl(undefined);
      return;
    }
    const hit = cachedAssetUrl(memory.assetId);
    if (hit) {
      setUrl(hit);
      return;
    }
    let alive = true;
    void resolveAsset(memory.assetId).then((resolved) => {
      if (alive) setUrl(resolved);
    });
    return () => {
      alive = false;
    };
  }, [memory.assetId, memory.imageUrl]);

  return url;
}

/**
 * One memory, drawn as the physical thing it is.
 * `width`/`height` are the content box; frames add their own chrome around it.
 */
export function MemoryObject({ memory }: { memory: Memory }) {
  const src = useAssetUrl(memory);
  const { w, h } = memory;

  switch (memory.type) {
    case 'sticky':
      return <StickyNote memory={memory} width={w} height={h} />;
    case 'note':
      return <HandNote memory={memory} width={w} height={h} />;
    case 'ticket':
      return <Ticket memory={memory} width={w} height={h} />;
    case 'label':
      return <LabelTag memory={memory} width={w} height={h} />;
    case 'postcard':
      return <Postcard memory={memory} src={src} width={w} height={h} />;
    default:
      return <Frame memory={memory} src={src} width={w} height={h} />;
  }
}
