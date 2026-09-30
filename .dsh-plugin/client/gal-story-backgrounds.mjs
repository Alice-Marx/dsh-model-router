import prologueStation from '../../aipicture/story-backgrounds/prologue-station.webp'
import associationOpenDay from '../../aipicture/story-backgrounds/association-open-day.webp'
import laurelTheatre from '../../aipicture/story-backgrounds/laurel-theatre.webp'
import bridgesNight from '../../aipicture/story-backgrounds/bridges-night.webp'
import threeHarbors from '../../aipicture/story-backgrounds/three-harbors.webp'
import openDomeHearing from '../../aipicture/story-backgrounds/open-dome-hearing.webp'
import protocolComposition from '../../aipicture/story-backgrounds/protocol-composition.webp'
import sixEndings from '../../aipicture/story-backgrounds/six-endings.webp'
import modelCityTitle from '../../aipicture/story-backgrounds/model-city-title.webp'
import laurelObservatory from '../../aipicture/story-backgrounds/laurel-observatory.webp'
import kimiRehearsal from '../../aipicture/story-backgrounds/kimi-rehearsal.webp'
import communityArchive from '../../aipicture/story-backgrounds/community-archive.webp'
import offlineWorkshop from '../../aipicture/story-backgrounds/offline-workshop.webp'
import evidenceLighthouse from '../../aipicture/story-backgrounds/evidence-lighthouse.webp'
import operationsBridge from '../../aipicture/story-backgrounds/operations-bridge.webp'

import { SPRING_BACKGROUNDS } from './gal-spring-backgrounds.mjs'
import { ECHO_SCENE_ART } from './gal-echo-art.mjs'

export const STORY_BACKGROUNDS = Object.freeze({
  ...SPRING_BACKGROUNDS,
  ...ECHO_SCENE_ART,
  title: modelCityTitle,
  prologue: prologueStation,
  'open-day': associationOpenDay,
  laurel: laurelTheatre,
  'bridges-night': bridgesNight,
  'three-harbors': threeHarbors,
  'open-dome-hearing': openDomeHearing,
  'protocol-composition': protocolComposition,
  'six-endings': sixEndings,
  'laurel-observatory': laurelObservatory,
  'kimi-rehearsal': kimiRehearsal,
  'community-archive': communityArchive,
  'offline-workshop': offlineWorkshop,
  'evidence-lighthouse': evidenceLighthouse,
  'operations-bridge': operationsBridge,
  'echo-tower-night': ECHO_SCENE_ART['echo-gate-snow'],
  'echo-city': sixEndings,
  'echo-city-dawn': sixEndings,
  'echo-city-dusk': bridgesNight,
  'echo-city-night': bridgesNight,
  'echo-gate': ECHO_SCENE_ART['echo-gate-snow'],
  'echo-archive': communityArchive,
  'echo-theatre': laurelTheatre,
  'echo-observatory': laurelObservatory,
  'echo-workshop': offlineWorkshop,
  'echo-harbor': threeHarbors,
  'echo-open-day': associationOpenDay,
  'echo-lighthouse': evidenceLighthouse,
  'echo-bridge': operationsBridge,
  'echo-protocol': protocolComposition,
})

// The first story predates chapter/background IDs. Its 41 authored locations
// are mapped to the closest bundled scene so it no longer falls back to the
// title art for every line. These are presentation choices, not save data.
export const LEGACY_SCENE_BACKGROUNDS = Object.freeze({
  模型城车站: 'prologue',
  迁移指挥室: 'operations-bridge',
  研究室: 'offline-workshop',
  街角休息区: 'community-archive',
  月光图书馆: 'community-archive',
  屋顶剧场: 'laurel-observatory',
  新城列车: 'prologue',
  车站长廊: 'prologue',
  模型城站台: 'prologue',
  公共餐厅: 'community-archive',
  餐厅后厨: 'offline-workshop',
  文书阁门廊: 'community-archive',
  指挥室窗边: 'operations-bridge',
  百科工坊: 'community-archive',
  议事厅: 'open-dome-hearing',
  工坊后院: 'offline-workshop',
  创新工坊: 'offline-workshop',
  天文台楼梯: 'laurel-observatory',
  屋顶剧场侧台: 'laurel',
  剧场更衣室: 'laurel',
  图书馆小庭院: 'community-archive',
  研究室东窗: 'offline-workshop',
  旧城回廊: 'bridges-night',
  旧城公共会馆: 'open-day',
  会馆长桌: 'community-archive',
  会馆后廊: 'bridges-night',
  会馆小舞台: 'laurel',
  会馆门廊: 'open-day',
  旧档案楼侧廊: 'community-archive',
  会馆临时晾晒区: 'community-archive',
  会馆厨房与休息角: 'offline-workshop',
  旧城街口: 'bridges-night',
  会馆展厅: 'open-day',
  公共记忆展: 'community-archive',
  会馆午间长桌: 'community-archive',
  会馆小院: 'open-day',
  新城街角与研究室: 'offline-workshop',
  新城公共阅览室: 'community-archive',
  暂住处与新城信箱: 'six-endings',
  新城工坊外: 'offline-workshop',
  两座城市的午后: 'six-endings',
})

export function backgroundForStoryNode(node) {
  return STORY_BACKGROUNDS[node?.backgroundId]
    || STORY_BACKGROUNDS[node?.chapterId]
    || STORY_BACKGROUNDS[LEGACY_SCENE_BACKGROUNDS[node?.location]]
    || STORY_BACKGROUNDS.title
}

export const sceneDescription = description => String(description ?? '').replace(/^空白场景：/, '')
