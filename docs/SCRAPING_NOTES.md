# Notas legais e operacionais — scraping NextEmbroidery

Leia isto antes de rodar **grandes volumes** de requisições.

## robots.txt (resumo)

Consultado em momento de documentação: `https://nextembroidery.com/robots.txt` continha:

- `User-agent: *`
- `Disallow: /author/`
- `Sitemap: .../sitemap_index.xml`

Não havia `Disallow` explícito para a página do conversor ou para `wp-admin/admin-ajax.php`. **Isso não substitui os Termos de uso do site**: políticas podem restringir uso automatizado mesmo onde robots.txt não bloqueia.

## Recomendações

1. **Termos de uso / política do site** — confirme se automação de conversões em massa é permitida para o seu caso de uso.
2. **Frequência** — use `--delay` de pelo menos **0,5–2 s** entre códigos; evite paralelismo agressivo.
3. **Volume** — comece com listas pequenas; monitore erros HTTP (429, 503) e faça backoff ou pause.
4. **Dados** — use os dados obtidos de forma compatível com licenças e com a política da sua empresa.
5. **Manutenção** — o HTML (`results-input`) ou o AJAX podem mudar; o script pode precisar de ajustes.

## O que estes scripts fazem

Eles reproduzem o fluxo público do conversor (GET de RGB + POST do formulário), como um navegador, para construir um dataset local. **Não** contornam login, paywall ou CAPTCHA.
