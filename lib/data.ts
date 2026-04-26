export type VideoCard = {
  id: string;
  title: string;
  creator: string;
  category: string;
  views: string;
  duration: string;
  qualityScore: number;
  velocity: number;
  publishedAt: string;
};

export const featuredVideos: VideoCard[] = [
  {
    id: "vid_01",
    title: "Neon Rooftop Sequence",
    creator: "Astra Studio",
    category: "Animation",
    views: "234K",
    duration: "2:14",
    qualityScore: 0.92,
    velocity: 0.67,
    publishedAt: "2026-04-23T12:00:00.000Z",
  },
  {
    id: "vid_02",
    title: "Tokyo Alley Loop",
    creator: "Kuro Nine",
    category: "Short Film",
    views: "140K",
    duration: "1:49",
    qualityScore: 0.86,
    velocity: 0.71,
    publishedAt: "2026-04-24T20:30:00.000Z",
  },
  {
    id: "vid_03",
    title: "Retro Garage Edit",
    creator: "Fluxx",
    category: "Music",
    views: "88K",
    duration: "0:58",
    qualityScore: 0.81,
    velocity: 0.74,
    publishedAt: "2026-04-25T14:15:00.000Z",
  },
];
