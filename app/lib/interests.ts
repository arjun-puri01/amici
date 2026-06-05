// Curated list of niche interests. Intentionally specific — not generic categories.
export type InterestCategory = {
  label: string;
  items: string[];
};

export const INTEREST_CATEGORIES: InterestCategory[] = [
  {
    label: 'Motorsport',
    items: ['F1 Racing', 'MotoGP', 'NASCAR', 'IndyCar', 'Rally Racing'],
  },
  {
    label: 'Strategy & Games',
    items: ['Chess', 'Go (Baduk)', 'Poker', 'Dungeons & Dragons', 'Competitive Magic: The Gathering', 'Speedrunning'],
  },
  {
    label: 'Music',
    items: ['Jazz', 'Classical Music', 'Metal', 'Hyperpop', 'Ambient / Drone', 'Bossa Nova', 'K-Pop', 'Afrobeats', 'Bluegrass', 'Experimental Electronic'],
  },
  {
    label: 'Outdoors',
    items: ['Rock Climbing', 'Backpacking', 'Surfing', 'Skiing', 'Mountaineering', 'Fly Fishing', 'Bouldering'],
  },
  {
    label: 'Combat Sports',
    items: ['BJJ', 'Boxing', 'Muay Thai', 'Wrestling', 'Judo', 'Fencing'],
  },
  {
    label: 'Racket Sports',
    items: ['Table Tennis', 'Squash', 'Badminton', 'Pickleball'],
  },
  {
    label: 'Arts & Making',
    items: ['Film Photography', 'Oil Painting', 'Ceramics / Pottery', 'Leatherworking', 'Woodworking', 'Embroidery / Textile Art', 'Glassblowing'],
  },
  {
    label: 'Food & Drink',
    items: ['Specialty Coffee', 'Natural Wine', 'Competitive Cooking / Culinary Arts', 'Fermentation', 'Foraging'],
  },
  {
    label: 'Science & Tech',
    items: ['Astronomy / Stargazing', 'Amateur Radio (Ham Radio)', 'Mechanical Keyboards', 'Homelab / Self-hosting', 'Competitive Programming'],
  },
  {
    label: 'Literature & Film',
    items: ['Science Fiction', 'Manga / Anime', 'Horror Films', 'Documentary Films', 'Poetry', 'Philosophy'],
  },
  {
    label: 'Fitness',
    items: ['Olympic Weightlifting', 'Powerlifting', 'Triathlon', 'Long-distance Running', 'Cycling', 'Gymnastics'],
  },
  {
    label: 'Social Impact',
    items: ['Urban Planning / Housing Policy', 'Climate Activism', 'Prison Reform', 'Animal Rights'],
  },
];
