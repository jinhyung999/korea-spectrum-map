import test from 'node:test';
import assert from 'node:assert/strict';
import { FAMILIES, FAMILY_BY_ID, familyOf, FALLBACK_FAMILY } from '../js/families.js';

const cases = {
  고정: 'fixed',
  이동: 'mobile',
  '이동(항공이동 제외)': 'mobile',
  육상이동: 'mobile',
  항공이동: 'airsea',
  해상이동: 'airsea',
  방송: 'broadcast',
  아마추어: 'amateur',
  아마추어위성: 'amateur',
  고정위성: 'fixedsat',
  '고정위성(지구대우주)': 'fixedsat',
  '이동위성(우주대지구)': 'mobilesat',
  항공이동위성: 'mobilesat',
  해상이동위성: 'mobilesat',
  방송위성: 'broadcastsat',
  '지구탐사위성(능동)': 'space',
  우주연구: 'space',
  위성간: 'space',
  항공무선항행: 'radionav',
  해상무선항행: 'radionav',
  무선항행위성: 'radionav',
  무선측위: 'radiolocation',
  무선탐지: 'radiolocation',
  무선측위위성: 'radiolocation',
  전파천문: 'astronomy',
  표준주파수및시보: 'timemeteo',
  기상원조: 'timemeteo',
};

test('업무 이름이 알맞은 계열로 간다', () => {
  for (const [name, fam] of Object.entries(cases)) assert.equal(familyOf(name), fam, name);
});

test('모르는 이름과 이상한 입력은 기타', () => {
  assert.equal(familyOf('처음 보는 업무'), FALLBACK_FAMILY);
  assert.equal(familyOf(''), FALLBACK_FAMILY);
  assert.equal(familyOf(undefined), FALLBACK_FAMILY);
});

test('계열은 10~14개이고 id가 겹치지 않으며 규칙이 가리키는 id가 모두 있다', () => {
  assert.ok(FAMILIES.length >= 10 && FAMILIES.length <= 14);
  assert.equal(new Set(FAMILIES.map((f) => f.id)).size, FAMILIES.length);
  for (const fam of Object.values(cases)) assert.ok(FAMILY_BY_ID[fam], fam);
});
