if (new URLSearchParams(window.location.search).get('mini') === 'true') {
  void import('./mini/main')
} else {
  void import('./desktop')
}
