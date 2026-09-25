export interface SamplePortrait {
  id: string;
  title: string;
  category: 'multi-person' | 'portrait' | 'challenging';
  url: string;
  description: string;
  expectedFacesCount: number;
}

export const SAMPLE_PORTRAITS: SamplePortrait[] = [
  {
    id: 'sample-group-1',
    title: 'Research Team Lab (Multi-Person)',
    category: 'multi-person',
    url: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=1200&q=80',
    description: 'Diverse group of 4 colleagues collaborating at workstation. Ideal for multi-face tracking and target following.',
    expectedFacesCount: 4,
  },
  {
    id: 'sample-alex',
    title: 'Alex (High Quality Frontal)',
    category: 'portrait',
    url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=800&q=80',
    description: 'Clear frontal studio portrait. Ideal for smart enrollment, quality analysis, and biometric lock verification.',
    expectedFacesCount: 1,
  },
  {
    id: 'sample-sarah',
    title: 'Sarah (Angled Expression)',
    category: 'portrait',
    url: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=800&q=80',
    description: 'Natural portrait with slight tilt and authentic happy expression. Great for emotion stability testing.',
    expectedFacesCount: 1,
  },
  {
    id: 'sample-david',
    title: 'David (Mature Portrait)',
    category: 'portrait',
    url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=800&q=80',
    description: 'Frontal male portrait with subtle smile. Tests age temporal estimation and identity stability.',
    expectedFacesCount: 1,
  },
  {
    id: 'sample-group-2',
    title: 'Tech Panel Conference (6+ People)',
    category: 'multi-person',
    url: 'https://images.unsplash.com/photo-1531482615713-2afd69097998?auto=format&fit=crop&w=1200&q=80',
    description: 'High-density multi-person scene testing simultaneous biometric identification and target discrimination.',
    expectedFacesCount: 5,
  },
  {
    id: 'sample-street',
    title: 'Cyberpunk Neon Street (Low Light)',
    category: 'challenging',
    url: 'https://images.unsplash.com/photo-1509099836639-18ba1795216d?auto=format&fit=crop&w=1200&q=80',
    description: 'Challenging illumination and dynamic contrast. Tests face quality analysis and graceful degradation.',
    expectedFacesCount: 2,
  },
];
