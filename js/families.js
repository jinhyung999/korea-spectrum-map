// 업무 이름 → 색 계열(family) 매핑. 실제 데이터의 업무 이름 목록을 본 뒤 여기만 고치면 된다.
// 색 자체는 css/style.css 의 --fam-<id> 변수에 있다.
//
// 규칙은 위에서 아래로 처음 맞는 것을 쓴다. 괄호 안 설명(예: "이동(항공이동 제외)")은
// 이름 판별에 쓰지 않는다. 그래서 "이동(항공이동 제외)"는 항공이동이 아니라 이동으로 분류된다.

export const FAMILIES = [
  { id: 'fixed', label: '고정', desc: '지점과 지점을 잇는 고정된 무선 통신' },
  { id: 'mobile', label: '이동', desc: '움직이는 단말과 하는 통신(육상이동 포함)' },
  { id: 'airsea', label: '항공·해상이동', desc: '항공기나 선박과 하는 통신' },
  { id: 'broadcast', label: '방송', desc: '라디오·TV 등 방송' },
  { id: 'amateur', label: '아마추어', desc: '취미·기술 연구용 무선국(위성 포함)' },
  { id: 'fixedsat', label: '고정위성', desc: '위성을 거쳐 고정된 지점끼리 하는 통신' },
  { id: 'mobilesat', label: '이동위성', desc: '위성과 이동하는 단말 사이 통신(항공·해상 포함)' },
  { id: 'broadcastsat', label: '방송위성', desc: '위성으로 하는 방송' },
  { id: 'space', label: '지구탐사·우주', desc: '지구탐사위성, 기상위성, 우주연구·운용 등' },
  { id: 'radionav', label: '무선항행', desc: '전파로 위치·방향을 알아 길을 찾는 업무(항행위성 포함)' },
  { id: 'radiolocation', label: '무선측위·탐지', desc: '레이더처럼 전파로 물체의 위치를 알아내는 업무' },
  { id: 'astronomy', label: '전파천문', desc: '천체가 내는 전파를 받아 관측' },
  { id: 'timemeteo', label: '표준주파수·기상', desc: '표준주파수·시보, 기상원조 업무' },
  { id: 'other', label: '기타', desc: '위 분류에 들지 않은 업무' },
];

export const FALLBACK_FAMILY = 'other';

const RULES = [
  [/방송위성/, 'broadcastsat'],
  [/고정위성/, 'fixedsat'],
  [/이동위성/, 'mobilesat'],
  [/아마추어/, 'amateur'],
  [/무선항행위성|위성항행/, 'radionav'],
  [/무선측위위성/, 'radiolocation'],
  [/표준주파수/, 'timemeteo'],
  [/지구탐사|기상위성|우주연구|우주운용|위성간|위성/, 'space'],
  [/전파천문/, 'astronomy'],
  [/표준주파수|시보|기상원조/, 'timemeteo'],
  [/무선항행/, 'radionav'],
  [/무선측위|무선탐지|무선표정/, 'radiolocation'],
  [/항공이동|해상이동/, 'airsea'],
  [/이동/, 'mobile'],
  [/방송/, 'broadcast'],
  [/고정/, 'fixed'],
];

export const FAMILY_BY_ID = Object.fromEntries(FAMILIES.map((f) => [f.id, f]));

const cache = new Map();

export function familyOf(name) {
  if (typeof name !== 'string') return FALLBACK_FAMILY;
  let id = cache.get(name);
  if (id) return id;
  const base = name.normalize('NFKC').replace(/[(（].*$/, '').replace(/\s+/g, '');
  id = FALLBACK_FAMILY;
  for (const [re, fam] of RULES) {
    if (re.test(base)) {
      id = fam;
      break;
    }
  }
  cache.set(name, id);
  return id;
}
