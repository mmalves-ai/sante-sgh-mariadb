// M60, etapa 2: o anexo "variáveis e portas" do manual de implantação, gerado do catálogo (nunca desatualiza).
import { CABECALHOS_SEGURANCA, LAYOUT } from './artefatos.ts';
import { CAMPOS_ESTABELECIMENTO, GRUPOS, VARIAVEIS } from './variaveis.ts';

const celula = (s: string) => s.replace(/\|/g, '\\|');

export function anexoVariaveis(): string {
  const l: string[] = [
    '# Anexo: variáveis do arquivo de ambiente e portas',
    '',
    '<!-- Gerado por `pnpm instalacao:gerar`; não edite à mão. -->',
    '',
    'O arquivo é `/etc/sante-sgh/sante.env` (0600, dono o usuário do serviço), a partir do modelo',
    '`deploy/ubuntu/sante.env.modelo`. **Obrigatória**: sem ela a conferência recusa a instalação. **Segredo**: só no',
    'servidor, nunca em repositório, e-mail ou chamado.',
    '',
  ];
  for (const g of GRUPOS) {
    const doGrupo = VARIAVEIS.filter((x) => x.grupo === g.grupo);
    if (doGrupo.length === 0) continue;
    l.push(`## ${g.titulo}`, '', '| variável | uso | segredo | descrição |', '|---|---|---|---|');
    for (const x of doGrupo)
      l.push(`| \`${x.chave}\` | ${x.uso} | ${x.segredo ? 'sim' : ''} | ${celula(x.descricao)} |`);
    l.push('');
    if (g.grupo === 'banco') {
      l.push(
        '### Série por estabelecimento (`FB_<CÓDIGO>_<CAMPO>`)',
        '',
        '| campo | uso | segredo | descrição |',
        '|---|---|---|---|',
      );
      for (const c of CAMPOS_ESTABELECIMENTO)
        l.push(`| \`${c.campo}\` | ${c.uso} | ${c.segredo ? 'sim' : ''} | ${celula(c.descricao)} |`);
      l.push('');
    }
  }
  l.push(
    '## Portas',
    '',
    '| porta | onde | quem acessa |',
    '|---|---|---|',
    '| 443 | nginx (HTTPS) | as estações e os celulares do hospital |',
    '| 80 | nginx (só redireciona para 443 e atende o desafio ACME) | as estações; a autoridade ACME |',
    '| 22 | SSH | só a TI (restrinja a origem no ufw) |',
    `| ${LAYOUT.portaApi} | API (só 127.0.0.1) | o nginx do próprio servidor |`,
    '| 6379 | Valkey (só 127.0.0.1) | a API e o worker do próprio servidor |',
    '| 3000 | conversor de documentos (só 127.0.0.1) | a API e o worker |',
    '| 3050 | Firebird, no servidor do banco | o servidor de aplicação (ou o túnel) |',
    '',
    '## Cabeçalhos de segurança do site',
    '',
    '| cabeçalho | valor |',
    '|---|---|',
    ...CABECALHOS_SEGURANCA.map(([k, v]) => `| \`${k}\` | \`${celula(v)}\` |`),
    '',
  );
  return l.join('\n');
}
