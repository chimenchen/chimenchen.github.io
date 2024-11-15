/* 推導普通話
 *
 * @author graphemecluster
 * @author JwietPuj-Drin
 * 
 * 選項「清聲母入聲調分派層次」詳見平山久雄《中古汉语的清入声在北京话里的对应规律》
 * http://ccj.pku.edu.cn/Article/DownLoad?id=271015083&&type=ArticleFile
 * 默認選擇為「皆派入陰平」，参考刘海阳在對「北京话的入声为什么会派入三个不同的声调？」的回答中披露的材料——
 * 「古代清音入声字在北京話的声調，凡是沒有异讀的，就采用北京已經通行的讀法。凡是有异讀的，假若其中有一个是陰平調，原則上就采用陰平，例如：“息”ㄒㄧ（xī）“击”ㄐㄧ（jī）。否則逐字考慮，采用比較通行……」
 * https://www.zhihu.com/question/30370012/answer/533234460
 * 
 * 選項「常母平聲陰聲韻聲母和船母平聲聲母」詳見 unt 對「为何中古的dʑ ʑ和普通话读音的对应似乎是反的（即dʑ > ʂ、ʑ > ʈʂ）？」的回答
 * https://www.zhihu.com/question/526195183/answer/2425807330
 */

/** @type { 音韻地位['屬於'] } */
const is = (...x) => 音韻地位.屬於(...x);
/** @type { 音韻地位['判斷'] } */
const when = (...x) => 音韻地位.判斷(...x);

const is更多選項 = 選項.更多選項 ?? false;

if (!音韻地位) return [
  ['標調方式', [2, '數字', '附標']],

  ['更多選項', is更多選項],
  ...(is更多選項 ? [
    '更多選項',
    ['清聲母入聲調分派層次',
      [2,
        '皆派入上聲',
        '皆派入陰平',
        '次清、擦音和零聲母字派入去聲，其餘派入陽平',
        '次清和零聲母字派入去聲，其餘派入陽平',
        '皆不標調',
        '連同濁聲母，所有入聲字皆派入去聲',
      ]
    ],
    ['常母平聲陰聲韻聲母和船母平聲聲母', [2, 'ch', 'sh']],
  ] : []),
];

const 聲母規則 = () => when([
  ['幫滂並母 C類', 'f'],
  ['幫母', 'b'],
  ['滂母', 'p'],
  ['並母', [['平聲', 'p'], ['', 'b']]],
  ['明母', [['C類 非 東尤韻', 'w'], ['', 'm']]],

  ['端母', 'd'],
  ['透母', 't'],
  ['定母', [['平聲', 't'], ['', 'd']]],
  ['泥孃母', 'n'],
  ['來母', 'l'],

  ['精母', 'z'],
  ['清母', 'c'],
  ['從母', [['平聲', 'c'], ['', 'z']]],
  ['心邪母', 's'],

  ['知莊章母', 'zh'],
  ['徹初昌母', 'ch'],
  ['澄崇母', [['平聲', 'ch'], ['', 'zh']]],
  ['常母', [['平聲 陽聲韻', 'ch'], ['', 'sh']]],
  ['生書母', 'sh'],
  ['俟船母', 'sh'],
  ['日母', 'r'],

  ['見母', 'g'],
  ['溪母', 'k'],
  ['羣母', [['平聲', 'k'], ['', 'g']]],
  ['曉匣母', 'h'],
  ['疑影云以母', ''],
], '無聲母規則');

const 舒聲韻母規則 = () => when([
  // 通攝
  ['通攝', [['三等 牙喉音', 'iong'], ['', 'ueng']]],

  // 江攝
  ['江韻', [['牙喉音', 'iang'], ['', 'uang']]],

  // 止攝
  ['止攝 合口', [['莊組', 'uai'], ['', 'uei']]],
  ['止攝', [['牙喉音', 'i'], ['', 'er']]],

  // 遇攝
  ['魚虞韻', 'ü'],
  ['模韻', 'u'],

  // 蟹攝
  ['祭韻 合口 莊組', 'uai'],
  ['齊祭廢韻', [['合口', 'uei'], ['', 'i']]],
  ['泰灰韻', [['開口', 'ai'], ['', 'uei']]],
  ['佳韻 牙喉音', [['合口', 'ua'], ['', 'ia']]],
  ['皆夬韻 牙喉音', [['合口', 'uai'], ['', 'ie']]],
  ['佳皆夬咍韻', [['合口', 'uai'], ['', 'ai']]],

  // 臻攝
  ['真殷韻', [['合口', 'ün'], ['', 'in']]],
  ['臻韻 或 痕韻 牙喉音', 'en'],
  ['文韻 牙喉音', 'ün'],
  ['痕魂文韻', 'uen'],
  ['元韻', [['合口', 'üan'], ['', 'ian']]],

  // 山攝
  ['寒刪山韻 合口', 'uan'],
  ['刪山韻 牙喉音', 'ian'],
  ['寒刪山韻', 'an'],
  ['仙先韻', [['合口', 'üan'], ['', 'ian']]],

  // 效攝
  ['蕭宵韻 或 肴韻 牙喉音', 'iao'],
  ['豪肴韻', 'ao'],

  // 果攝
  ['歌韻 一等', [['開口 牙喉音', 'e'], ['', 'uo']]],
  ['歌韻 三等', [['開口', 'ie'], ['脣音', 'uo'], ['', 'üe']]],

  // 假攝
  ['麻韻 二等', [['合口', 'ua'], ['牙喉音', 'ia'], ['', 'a']]],
  ['麻韻 三四等', 'ie'],

  // 宕攝
  ['唐韻 開口', 'ang'],
  ['陽韻 (開口 非 莊組 或 A類)', 'iang'],
  ['唐陽韻', 'uang'],

  // 梗攝
  ['梗攝 二等', [['合口', 'ueng'], ['', 'eng']]],
  ['梗攝', [['合口', 'iong'], ['', 'ing']]],

  // 曾攝
  ['登韻', [['合口', 'ueng'], ['', 'eng']]],
  ['蒸韻', 'ing'],

  // 流攝
  ['侯韻', 'ou'],
  ['尤韻', [['幫組', 'ou'], ['', 'iou']]],
  ['幽韻', [['幫組', 'iao'], ['', 'iou']]],

  // 深攝
  ['侵韻', 'in'],

  // 咸攝
  ['鹽添韻 或 嚴咸銜韻 牙喉音', 'ian'],
  ['覃談嚴咸銜韻', 'an'],
  ['凡韻', 'uan'],
], '無韻母規則');

const 入聲韻母規則 = () => when([
  // 通攝
  ['通攝', [['三等 牙喉音', 'ü'], ['', 'u']]],

  // 江攝
  ['江韻', [['牙喉音', 'üe'], ['', 'uo']]],

  // 臻攝
  ['真韻 合口', [['莊組', 'uai'], ['', 'ü']]],
  ['真殷韻', 'i'],
  ['臻痕韻', 'e'],
  ['魂韻', [['幫組', 'o'], ['', 'u']]],
  ['文韻', 'ü'],
  ['元韻', [['開口', 'ie'], ['牙喉音', 'üe'], ['', 'a']]],

  // 山攝
  ['寒韻', [['非 開口', 'uo'], ['牙喉音', 'e'], ['', 'a']]],
  ['刪山韻', [['合口', 'ua'], ['牙喉音', 'ia'], ['', 'a']]],
  ['仙先韻', [['合口', 'üe'], ['', 'ie']]],

  // 宕攝
  ['唐韻', [['開口 牙喉音', 'e'], ['', 'uo']]],
  ['陽韻', [['幫組', 'o'], ['', 'üe']]],

  // 梗攝
  ['梗攝 二等', [['開口', 'e'], ['', 'uo']]],
  ['梗攝', [['合口', 'ü'], ['', 'i']]],

  // 曾攝
  ['登韻', [['開口', 'e'], ['', 'uo']]],
  ['蒸韻', [['合口', 'ü'], ['莊組', 'e'], ['', 'i']]],

  // 深攝
  ['侵韻', [['莊組', 'e'], ['', 'i']]],

  // 咸攝
  ['覃談韻', [['牙喉音', 'e'], ['', 'a']]],
  ['鹽添嚴韻', 'ie'],
  ['咸銜凡韻', [['牙喉音', 'ia'], ['', 'a']]],
], '無韻母規則');

const 聲調規則 = () => when([
  ['清音', [
    ['平聲', '1'],
    ['上聲', '3'],
    ['去聲', '4'],
    ['入聲', ''],
  ]],
  ['濁音', [
    ['平聲', '2'],
    ['上聲', [['全濁', '4'], ['次濁', '3']]],
    ['去聲', '4'],
    ['入聲', [['全濁', '2'], ['次濁', '4']]],
  ]],
], '無聲調規則');

let 聲母 = 聲母規則();
let 韻母 = is`舒聲` ? 舒聲韻母規則() : 入聲韻母規則();
let 聲調 = 聲調規則();

if (選項.更多選項) {
  // 參考 https://www.zhihu.com/question/526195183/answer/2425807330
  if (is`(常母 陰聲韻 或 船母) 平聲`) 聲母 = 選項.常母平聲陰聲韻聲母和船母平聲聲母;

  /* 參考
   * http://ccj.pku.edu.cn/Article/DownLoad?id=271015083&&type=ArticleFile (https://web.archive.org/web/20240223084634/http://ccj.pku.edu.cn/Article/DownLoad?id=271015083&&type=ArticleFile)
   * https://www.zhihu.com/question/30370012/answer/533234460
   * https://www.zhihu.com/question/30370012/answer/535713330
   */
  if (is`入聲`) {
    switch (選項.清聲母入聲調分派層次) {
      case '皆派入上聲':
        if (is`清音`) 聲調 = '3';
        break;
      case '皆派入陰平':
        if (is`清音`) 聲調 = '1';
        break;
      case '次清、擦音和零聲母字派入去聲，其餘派入陽平':
        if (is`心生書影曉母 或 次清`) 聲調 = '4';
        else if (is`全清`) 聲調 = '2';
        break;
      case '次清和零聲母字派入去聲，其餘派入陽平':
        if (is`影母 或 次清`) 聲調 = '4';
        else if (is`全清`) 聲調 = '2';
        break;
      case '連同濁聲母，所有入聲字皆派入去聲':
        聲調 = '4';
        break;
    }
  }
}

if (['i', 'ü'].includes(韻母[0])) 聲母 = {
  g: 'j', k: 'q', h: 'x',
  z: 'j', c: 'q', s: 'x',
}[聲母] || 聲母;

if (韻母 === 'er') {
  if (聲母 === 'r') 聲母 = '';
  else 韻母 = 'i';
}

if (['n', 'l'].includes(聲母) && ['ua', 'uai', 'uang', 'uei'].includes(韻母)) 韻母 = 韻母.slice(1);
if (韻母[0] === 'ü' && !(['n', 'l'].includes(聲母) && ['ü', 'üe'].includes(韻母))) {
  if (!聲母) 聲母 = 'y';
  韻母 = 'u' + 韻母.slice(1);
}

if (['zh', 'ch', 'sh', 'r'].includes(聲母)) {
  if (韻母[0] === 'i') {
    if (韻母[1] === 'n') 韻母 = 'e' + 韻母.slice(1);
    else if (韻母[1]) 韻母 = 韻母.slice(1);
  }
  if (韻母 === 'ue') 韻母 = 'uo';
}

if (['b', 'p', 'm', 'f', 'w'].includes(聲母) && 韻母[0] === 'u' && 韻母[1]) 韻母 = 韻母.slice(1);
if (['f', 'w'].includes(聲母) && 韻母[0] === 'i') 韻母 = 韻母.slice(1) || 'ei';

if (!聲母) {
  if (韻母[0] === 'i') 聲母 = 'y';
  if (韻母[0] === 'u') 聲母 = 'w';
  if (聲母 && 韻母[1] && 韻母[1] !== 'n') 韻母 = 韻母.slice(1);
}

韻母 = { iou: 'iu', uei: 'ui', uen: 'un', ueng: 'ong' }[韻母] || 韻母;

if (選項.標調方式 === '數字') return 聲母 + 韻母 + 聲調;
return 聲母 + (聲調 ? 韻母.replace(/.*a|.*[eo]|.*[iuü]/, '$&' + ' ̄́̌̀'[聲調]) : 韻母);