// pnpm indicadores:controle -- --hospital=<cod|todos> (ficha do M16, seções 10 e 11; DP-41: a cópia real de dev é
// a cópia de referência). Na cópia do projeto (READ ONLY, loopback, AMBIENTE=dev), calcula pelo motor do sistema os
// valores de controle — internações por ano, caráter, clínica, motivo de alta, internados no fim da cópia,
// transferências, trechos, leitos e as duas réguas da receita de 2025 — e compara com os da ficha (cópia de
// 05-06/07/2026). Cópia mais nova: as consultas de controle valem e só o resultado é registrado. Grava o resumo
// agregado em docs/marcos/M16/controle-<cod>.json (só contagens e somas; nenhum dado de pessoa). Sai 1 com diferença.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MotorInternacao, relogioDeParede } from '@sgh/dominio-internacao';
import { seriesFinanceiras, totalDaSerie } from '@sgh/dominio-relatorio';
import { lerFinanceiroMensal, lerLeiturasPainel, lerMovimentoInternacao } from '@sgh/legado';
import { abrirNucleoCopia } from './copia-leitura.ts';

const raiz = resolve(import.meta.dirname, '../../..');

/** Valores de controle da ficha do M16 (seção 10) e da receita (BRIEF §3; cap-11 §11.3), cópia de 05-06/07/2026. */
export const CONTROLE_REFERENCIA: Readonly<Record<string, number>> = {
  'internacoes.2020': 1260,
  'internacoes.2021': 1055,
  'internacoes.2022': 1202,
  'internacoes.2023': 1526,
  'internacoes.2024': 1597,
  'internacoes.2025': 1573,
  'internacoes.2026': 943,
  'carater.urgencia': 5070,
  'carater.eletiva': 4090,
  'clinica.medica': 4888,
  'clinica.cirurgica': 4268,
  'motivo.melhorado': 8150,
  'motivo.obito': 401,
  'motivo.evasao': 324,
  'motivo.transferencia': 122,
  'motivo.internacaoDomiciliar': 83,
  'motivo.encerramentoAdministrativo': 48,
  transferencias: 7099,
  trechos: 16263,
  internadosNoFim: 24,
  leitos: 109,
  leitosAtivos: 61,
  'receita2025.cobradoDataDoItemMi': 83.6,
  'receita2025.pagoDataDoItemMi': 65.9,
  'receita2025.cobradoCompetenciaMi': 83.9,
  'receita2025.pagoCompetenciaMi': 65.7,
};

const mi = (v: number) => Math.round(v / 100_000) / 10;

async function controle(hospital: string): Promise<{ valores: Record<string, number>; dadosAte: string }> {
  const { nucleo } = abrirNucleoCopia();
  try {
    const ctx = { rede: nucleo.rede, hospital, traceId: 'indicadores-controle' };
    const mov = await nucleo.lerSomente(ctx, (l) => lerMovimentoInternacao(l));
    const painel = await nucleo.lerSomente(ctx, (l) => lerLeiturasPainel(l));
    const fin = await nucleo.lerSomente(ctx, (l) => lerFinanceiroMensal(l, '2025-01', '2025-12'));
    const v: Record<string, number> = {};
    const conta = (f: (i: (typeof mov.internacoes)[number]) => boolean) => mov.internacoes.filter(f).length;
    for (let a = 2020; a <= 2026; a++) v[`internacoes.${a}`] = conta((i) => i.entrada.getUTCFullYear() === a);
    v['carater.urgencia'] = conta((i) => i.carater === '2');
    v['carater.eletiva'] = conta((i) => i.carater === '1');
    v['clinica.medica'] = conta((i) => i.clinica === 'M');
    v['clinica.cirurgica'] = conta((i) => i.clinica === 'C');
    // Por código do motivo, como a ficha conta (o grupo do indicador soma códigos vizinhos: ver as evidências).
    v['motivo.melhorado'] = conta((i) => i.motivo === 12);
    v['motivo.obito'] = conta((i) => i.motivo === 41);
    v['motivo.evasao'] = conta((i) => i.motivo === 16);
    v['motivo.transferencia'] = conta((i) => i.motivo === 31);
    v['motivo.internacaoDomiciliar'] = conta((i) => i.motivo === 32);
    v['motivo.encerramentoAdministrativo'] = conta((i) => i.motivo === 51);
    v['transferencias'] = mov.transferencias.length;
    v['trechos'] = mov.trechos.length;
    const m = new MotorInternacao(mov, {
      horaFechamento: 24,
      intensivas: [3, 7, 8, 9, 17],
      agora: relogioDeParede(Date.now()),
    });
    v['internadosNoFim'] = m.censoDoDia(m.dataAtual).reduce((s, l) => s + l.internados, 0);
    v['leitos'] = painel.leitos.length;
    v['leitosAtivos'] = painel.leitos.filter((x) => x.status === 'A').length;
    const meses = Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, '0')}`);
    const s = seriesFinanceiras(fin, meses, '2099-01');
    const tot = (c: string) =>
      mi(
        totalDaSerie(
          s.find((x) => x.codigo === c)!,
          meses,
        ),
      );
    v['receita2025.cobradoDataDoItemMi'] = tot('cobrado-data-do-item');
    v['receita2025.pagoDataDoItemMi'] = tot('pago-data-do-item');
    v['receita2025.cobradoCompetenciaMi'] = tot('cobrado-competencia');
    v['receita2025.pagoCompetenciaMi'] = tot('pago-competencia');
    // Grupos do indicador (regra 8), para a validação conferir com a tela.
    const [g2025] = m.basesMensais('2025-01', '2025-12').reduce(
      (acc, b) => {
        for (const [k, n] of Object.entries(b.altasPorGrupo)) acc[0]![k] = (acc[0]![k] ?? 0) + n;
        return acc;
      },
      [{} as Record<string, number>],
    );
    for (const [k, n] of Object.entries(g2025!)) v[`grupo2025.${k}`] = n;
    return { valores: v, dadosAte: mov.dadosAte.toISOString().slice(0, 10) };
  } finally {
    await nucleo.encerrar();
  }
}

const arg =
  process.argv
    .slice(2)
    .find((a) => a.startsWith('--hospital='))
    ?.slice(11) ?? 'todos';
const { codigos, nucleo: n0 } = abrirNucleoCopia();
await n0.encerrar();
let ok = true;
for (const cod of arg === 'todos' ? codigos : [arg]) {
  try {
    const r = await controle(cod);
    const referencia = r.dadosAte >= '2026-07-05' && r.dadosAte <= '2026-07-06';
    const diferencas = referencia
      ? Object.entries(CONTROLE_REFERENCIA)
          .filter(([k, esperado]) => r.valores[k] !== esperado)
          .map(([k, esperado]) => `${k}: esperado ${esperado}, obtido ${r.valores[k]}`)
      : [];
    if (diferencas.length > 0) ok = false;
    mkdirSync(resolve(raiz, 'docs/marcos/M16'), { recursive: true });
    writeFileSync(
      resolve(raiz, `docs/marcos/M16/controle-${cod}.json`),
      `${JSON.stringify({ estabelecimento: cod, dadosAte: r.dadosAte, copiaDeReferencia: referencia, valores: r.valores, diferencas }, null, 2)}\n`,
    );
    console.log(
      `[${cod}] dados até ${r.dadosAte}${referencia ? ' (cópia de referência)' : ' (cópia mais nova: valem as consultas de controle)'}: ${diferencas.length === 0 ? 'valores de controle iguais' : `${diferencas.length} diferença(s)`}`,
    );
    for (const d of diferencas) console.log(`  ${d}`);
  } catch (e) {
    ok = false;
    console.log(
      `[${cod}] falhou: ${e instanceof Error ? `${e.name}: ${e.message.slice(0, 200)}` : 'erro'} (sem a cópia no ar: Bloqueio HS-1 quando for o hs)`,
    );
  }
}
process.exit(ok ? 0 : 1);
