/**
 * 《未寄出的春天》专属场景图。原始底图由并行美术流程生成于
 * output/spring/raw/，此处按 1280 宽 WebP 入库；spring-dawn 复用
 * 千桥协议的终幕广场图（同为"黎明广场"意象）。
 */
import workshop from './spring-backgrounds/spring-workshop.webp'
import archive from './spring-backgrounds/spring-archive.webp'
import clock from './spring-backgrounds/spring-clock.webp'
import garden from './spring-backgrounds/spring-garden.webp'
import station from './spring-backgrounds/spring-station.webp'
import dawn from './spring-backgrounds/spring-dawn.webp'

export const SPRING_BACKGROUNDS = Object.freeze({
  'spring-workshop': workshop,
  'spring-archive': archive,
  'spring-clock': clock,
  'spring-garden': garden,
  'spring-station': station,
  'spring-dawn': dawn,
})
