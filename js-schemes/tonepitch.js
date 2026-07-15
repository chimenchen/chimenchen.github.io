if (!音韻地位) return [];

const is = (...x) => 音韻地位.屬於(...x);
const when = (...x) => 音韻地位.判斷(...x);

function get聲母() {
  return '|l'
}

function get韻母() {
  return ['', '|a', ''];
}

function get聲調() {
    if (is`清音`)
      return { 平: '6|55', 上: '3|313', 去: '2|31', 入: '5|4' }[音韻地位.聲] || '';
    else
      return { 平: '5|44', 上: '2|212', 去: '1|21', 入: '3|2' }[音韻地位.聲] || ''; 
}

const 聲母 = get聲母();
const [介音, 元音, 韻尾] = get韻母();
const 聲調 = get聲調();

return [聲母, 介音, 元音, 韻尾, 聲調].join(',');