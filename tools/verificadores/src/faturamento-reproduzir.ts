// pnpm faturamento:reproduzir -- --de=AAAA-MM --ate=AAAA-MM [--hospital=<cod|todos>] [--amostra=<n>] (ficha do M30, seção
// 10; cap-14 §14.4.2; script novo registrado em ESTADO.md › Desvios): o explicador de preço sobre os itens da conta de
// cada mês e grupo na cópia real (DP-41 decidida: as cópias de dev), por amostra determinística (os primeiros N itens de
// cada mês e TIPO pela ordem do ID; D-REPRO-30), e o relatório agregado por grupo, convênio e causa em
// docs/marcos/M30/reproducao.md, com o grupo apto à liberação do lançamento manual quando o acerto atinge a meta
// (99% SADT e diárias e taxas, 98% mat/med, 97% honorários). Só leitura; só AMBIENTE=dev na cópia do projeto
// (loopback). Saída só com contagens (nenhum valor de linha nem nome).
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { META_REPRODUCAO, ROTULO_GRUPO, type GrupoItem, grupoAtingeMeta } from '@sgh/dominio-faturamento';
import { reproduzirFaturamento } from '@sgh/legado';
import { abrirNucleoCopia } from './copia-leitura.ts';

const args = process.argv.slice(2);
const opc = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const de = opc('de') ?? '2025-01';
const ate = opc('ate') ?? '2026-06';
const pedido = opc('hospital') ?? 'pc';
const amostra = Math.min(5_000, Math.max(50, Number(opc('amostra') ?? 400) || 400));
if (!/^\d{4}-\d{2}$/.test(de) || !/^\d{4}-\d{2}$/.test(ate) || de > ate) {
  console.error(
    'Uso: pnpm faturamento:reproduzir -- --de=AAAA-MM --ate=AAAA-MM [--hospital=<cod>] [--amostra=<n>]',
  );
  process.exit(2);
}
const meses: string[] = [];
for (
  let a = Number(de.slice(0, 4)), m = Number(de.slice(5, 7));
  `${a}-${String(m).padStart(2, '0')}` <= ate;
  m === 12 ? ((m = 1), (a += 1)) : (m += 1)
)
  meses.push(`${a}-${String(m).padStart(2, '0')}`);

const raiz = resolve(import.meta.dirname, '../../..');
const { nucleo, codigos } = abrirNucleoCopia();
let ok = true;
try {
  const alvos = pedido === 'todos' ? codigos : codigos.filter((c) => c === pedido);
  if (pedido === 'todos' && alvos.length < 2)
    console.log(
      `Bloqueio: só ${alvos.join(', ')} configurado; os demais estabelecimentos aguardam a cópia (HS-1).`,
    );
  const partes: string[] = [];
  for (const h of alvos) {
    const ctx = { rede: nucleo.rede, hospital: h, traceId: 'faturamento-reproduzir' };
    const t0 = Date.now();
    const r = await nucleo.lerSomente(ctx, (l) =>
      reproduzirFaturamento(l, {
        meses,
        porMesGrupo: amostra,
        aoProgresso: (m, n) =>
          console.log(`[${h}] ${m}: ${n} item(ns) explicados (${Math.round((Date.now() - t0) / 1000)} s)`),
      }),
    );
    const linhas = (Object.keys(r.porGrupo) as GrupoItem[]).map((g) => {
      const x = r.porGrupo[g];
      const acerto = x.total ? (100 * x.conferem) / x.total : 0;
      const causas = Object.entries(x.causas)
        .sort((a, b) => b[1] - a[1])
        .map(([c, n]) => `${c} ${n}`)
        .join(', ');
      return `| ${ROTULO_GRUPO[g]} | ${x.total} | ${x.conferem} | ${acerto.toFixed(2).replace('.', ',')}% | ${(META_REPRODUCAO[g] * 100).toFixed(0)}% | ${grupoAtingeMeta(g, x.conferem, x.total) ? '**apto**' : 'segue no sistema em uso'} | ${causas} |`;
    });
    const conv = r.porConvenio.map(
      (v) =>
        `| ${v.convenio} | ${ROTULO_GRUPO[v.grupo]} | ${v.total} | ${v.total ? ((100 * v.conferem) / v.total).toFixed(1).replace('.', ',') : '0'}% |`,
    );
    partes.push(
      [
        `## Estabelecimento ${h}`,
        '',
        `Período ${de} a ${ate} (${meses.length} meses); amostra de até ${amostra} itens por mês e grupo (os primeiros pela ordem do ID; D-REPRO-30); ${Math.round((Date.now() - t0) / 1000)} s.`,
        '',
        '| grupo | itens explicados | conferem | acerto | meta | situação | causas |',
        '|---|---|---|---|---|---|---|',
        ...linhas,
        '',
        '### Acerto por convênio (os 10 com mais itens na amostra)',
        '',
        '| convênio | grupo | itens | acerto |',
        '|---|---|---|---|',
        ...conv,
        '',
      ].join('\n'),
    );
    for (const l of linhas) console.log(`[${h}] ${l}`);
  }
  writeFileSync(
    resolve(raiz, 'docs/marcos/M30/reproducao.md'),
    [
      '# M30: teste de reprodução do faturamento (relatório agregado)',
      '',
      `Gerado por \`pnpm faturamento:reproduzir -- --de=${de} --ate=${ate} --hospital=${pedido} --amostra=${amostra}\` em ${new Date().toISOString().slice(0, 10)} sobre a cópia de dev (DP-41).`,
      'Só agregados: o explicador de preço (somente leitura) sobre a amostra; "confere" quando o preço reconstruído pela tabela do contrato bate com o gravado no item (ao centavo).',
      'O grupo **apto** pode ter o lançamento manual liberado (GRUPOS_NA_META, depois da conferência no outro sistema); os demais seguem no sistema em uso, na mesma conta.',
      '',
      ...partes,
    ].join('\n'),
  );
  console.log('gravado docs/marcos/M30/reproducao.md');
} catch (e) {
  ok = false;
  console.error(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
} finally {
  await nucleo.encerrar();
}
process.exit(ok ? 0 : 1);
