const resolutionLike = new Set([360, 480, 540, 576, 720, 900, 1080, 1440, 2160]);

const seasonRegexes = [
  /\bS(?:eason)?\s*0?([1-9]\d?)\b/i,
  /\b([1-9]\d?)(?:st|nd|rd|th)\s+Season\b/i,
  /\bPart\s*0?([1-9]\d?)\b/i,
];

export interface ParsedVideo {
  baseTitle: string;
  season: number | null;
  episode: number | null;
  queryTitles: string[];
}

export const SubtitleNameHeuristics = {
  parseVideo(name: string): ParsedVideo {
    const stem = removeExtension(name);
    const season = this.extractSeason(stem);
    const episode = this.extractEpisode(stem);
    const baseTitle = cleanBaseTitle(stem);

    if (!baseTitle) {
      throw new Error(`无法从文件名中识别剧名：${name}`);
    }

    const queries = new Set<string>();
    queries.add(baseTitle);

    if (season !== null) {
      queries.add(`${baseTitle} Season ${season}`);
      queries.add(`${baseTitle} ${ordinal(season)} Season`);
      queries.add(`${baseTitle} S${season}`);
    }

    queries.add(baseTitle.replace(/\b\d+(st|nd|rd|th)?\s+season\b/gi, "").trim());

    return {
      baseTitle,
      season,
      episode,
      queryTitles: Array.from(queries)
        .map((item) => this.normalize(item))
        .filter(Boolean),
    };
  },

  extractEpisode(name: string): number | null {
    const stem = removeExtension(name);

    const sxe = /\bS\d{1,2}\s*E(\d{1,3})\b/i.exec(stem);
    if (sxe) {
      return parseNumber(sxe[1]);
    }

    const episode = /\b(?:E|EP|Episode)\s*0?(\d{1,3})\b/i.exec(stem);
    if (episode) {
      return parseNumber(episode[1]);
    }

    const cnjp = /第\s*([0-9]{1,3})\s*[话話集]/.exec(stem);
    if (cnjp) {
      return parseNumber(cnjp[1]);
    }

    const genericMatches = Array.from(
      stem.matchAll(/(?:^|[\s._\-\[\(])0*([0-9]{1,3})(?=$|[\s._\-\]\)\[\(])/g),
    )
      .map((match) => {
        const value = parseNumber(match[1]);
        if (value === null || value < 1 || value > 300 || resolutionLike.has(value)) {
          return null;
        }
        return {
          value,
          index: match.index ?? -1,
        };
      })
      .filter((item): item is { value: number; index: number } => item !== null);

    if (genericMatches.length === 0) {
      return null;
    }

    genericMatches.sort((left, right) => right.index - left.index);
    return genericMatches[0].value;
  },

  extractSeason(name: string): number | null {
    for (const regex of seasonRegexes) {
      const matched = regex.exec(name);
      if (!matched) {
        continue;
      }
      const season = parseNumber(matched[1]);
      if (season !== null && season >= 1 && season <= 99) {
        return season;
      }
    }
    return null;
  },

  normalize(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\p{L}\d]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();
  },
};

function cleanBaseTitle(name: string): string {
  let text = name;
  text = text.replace(/\[[^\]]*]/g, " ");
  text = text.replace(/\([^\)]*\)/g, " ");
  text = text.replace(/\{[^}]*\}/g, " ");
  text = text.replace(/\bS(?:eason)?\s*\d+\b/gi, " ");
  text = text.replace(/\b\d+(st|nd|rd|th)\s+season\b/gi, " ");
  text = text.replace(/\b(?:E|EP|Episode)\s*\d+\b/gi, " ");
  text = text.replace(/第\s*\d+\s*[话話集]/g, " ");
  text = text.replace(/(?:^|[\s._\-\[\(])0*\d{1,3}(?=$|[\s._\-\]\)\[\(])/g, " ");
  text = text.replace(
    /\b(HEVC|x265|x264|10bit|8bit|AAC|FLAC|WEBRip|BDRip|BluRay|WEB|TV|AT-X|AMZN|NF)\b/gi,
    " ",
  );
  text = text.replace(/\b(360p|480p|540p|576p|720p|1080p|1440p|2160p)\b/gi, " ");
  text = text.replaceAll("_", " ").replaceAll(".", " ").replaceAll("-", " ");
  return text.replace(/\s+/g, " ").trim();
}

function removeExtension(name: string): string {
  const dotIndex = name.lastIndexOf(".");
  return dotIndex <= 0 ? name : name.slice(0, dotIndex);
}

function ordinal(value: number): string {
  if (value % 100 >= 11 && value % 100 <= 13) {
    return `${value}th`;
  }
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

function parseNumber(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}
