// Áp dụng theme (sáng/tối) trước khi vẽ trang để không bị nháy. Dùng chung khóa "wb-theme" với blog công khai.
(function () {
  try {
    var t = localStorage.getItem('wb-theme') || 'auto';
    if (t === 'auto') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();
