// Regra 9 do M37 (cap-15 §15.8): relatório diário gerado pela IA (estado das operações, esteira, cobertura,
// pendências) e semanal para a diretoria (setores liberados, uso, chamados, carga do banco, decisões vencendo), por
// `pnpm coexistencia:relatorio -- --periodo=<dia|semana> --hospital=<pc|hs|todos>`, em
// docs/coexistencia/relatorios/AAAA-MM-DD.md. Só contagens agregadas (abaixo de 5: "<5") e nomes de estrutura; toda
// parcela impressa com a conta ("novo 61 de 100 = 61%"); nenhum nome de pessoa nem de paciente. Os textos não citam o
// outro sistema pelo nome (ADR 0023).
import type { Parcela, PeriodoRelatorioCoex } from '@sgh/contratos';
import { contagemSegura } from '../prontidao/prontidao.js';
import { textoParcela } from './parcela.js';

export interface HospitalDoRelatorio {
  readonly codigo: string;
  readonly nome: string;
  /** null: sem a cópia do estabelecimento (o motivo vai em `bloqueio`). */
  readonly bloqueio: string | null;
  readonly aguardandoPrimeiro: boolean;
  readonly operacoes: Readonly<Record<string, number>>;
  readonly setores: readonly {
    codigo: string;
    nome: string;
    onda: number;
    situacao: string;
    pessoas: number;
    treinados: number;
    parcela: Parcela;
  }[];
  readonly chamados: readonly { severidade: string; abertos: number; vencidos: number; resolvidos: number }[];
  readonly carga: {
    conexoesPorSistema: readonly { sistema: string; conexoes: number }[];
    transacoesLongas: number;
  } | null;
  readonly lotes: { aplicados: number; recolhidos: number };
  /** M43 (regra 9): setores depois da meta da onda, ainda no outro sistema (a coexistência deles se prolonga). */
  readonly atrasados?: readonly {
    codigo: string;
    nome: string;
    onda: number;
    situacao: string;
    meta: string;
    novaData: string;
  }[];
}

export interface DadosRelatorioCoex {
  readonly periodo: PeriodoRelatorioCoex;
  readonly dia: string;
  readonly inicio: string;
  readonly geradoEm: string;
  readonly hospitais: readonly HospitalDoRelatorio[];
  readonly esteira: { verificar: string; cobertura: string };
  /** Decisões e pendências (DP-nn, passo da validação) com o prazo, quando houver. */
  readonly decisoes: readonly { id: string; assunto: string; prazo: string | null; vencendo: boolean }[];
}

const linhaTabela = (cols: readonly (string | number)[]) => `| ${cols.join(' | ')} |`;

/** Rótulo da situação do setor (o mesmo da tela). */
const SITUACAO: Readonly<Record<string, string>> = {
  legado: 'no outro sistema',
  homologacao: 'em homologação',
  treinamento: 'em treinamento',
  liberado: 'liberado',
  acompanhamento: 'em acompanhamento',
  migrado: 'migrado',
};

export function relatorioCoexistenciaMarkdown(d: DadosRelatorioCoex): string {
  const titulo =
    d.periodo === 'dia'
      ? `# Relatório diário da coexistência — ${d.dia}`
      : `# Relatório semanal da coexistência — ${d.inicio} a ${d.dia}`;
  const l: string[] = [
    titulo,
    '',
    `Gerado em ${d.geradoEm} por \`pnpm coexistencia:relatorio -- --periodo=${d.periodo}\`. Só contagens agregadas (abaixo de 5: "<5"); nenhum dado de pessoa ou de paciente.`,
    '',
    '## Esteira',
    '',
    `- Verificação: ${d.esteira.verificar}.`,
    `- Cobertura: ${d.esteira.cobertura}.`,
    '',
  ];
  for (const h of d.hospitais) {
    l.push(`## ${h.nome} (${h.codigo})`, '');
    if (h.bloqueio) {
      l.push(`Bloqueio: ${h.bloqueio}.`, '');
      continue;
    }
    if (h.aguardandoPrimeiro)
      l.push(
        'Aguardando o ProntoCardio: as ondas deste estabelecimento só começam depois de todas no ProntoCardio (DP-4).',
        '',
      );
    const ops = Object.entries(h.operacoes).sort((a, b) => a[0].localeCompare(b[0]));
    l.push(
      '### Estado das operações',
      '',
      ops.length ? ops.map(([e, n]) => `${e}: ${n}`).join('; ') + '.' : 'Nenhuma operação no catálogo.',
      '',
    );
    l.push('### Setores', '');
    l.push(
      linhaTabela(['setor', 'onda', 'situação', 'pessoas', 'treinadas', 'parcela no novo (último dia)']),
    );
    l.push(linhaTabela(['---', '---', '---', '---', '---', '---']));
    for (const s of h.setores)
      l.push(
        linhaTabela([
          s.nome,
          s.onda,
          SITUACAO[s.situacao] ?? s.situacao,
          contagemSegura(s.pessoas),
          contagemSegura(s.treinados),
          textoParcela(s.parcela),
        ]),
      );
    const liberados = h.setores.filter((s) => ['liberado', 'acompanhamento', 'migrado'].includes(s.situacao));
    l.push(
      '',
      `Setores liberados: ${liberados.length} de ${h.setores.length}. Lotes de liberação: ${h.lotes.aplicados} aplicado(s), ${h.lotes.recolhidos} recolhido(s).`,
      '',
    );
    if (d.periodo === 'semana' || (h.atrasados?.length ?? 0) > 0) {
      l.push('### Setores no outro sistema depois da meta da onda', '');
      if (!h.atrasados || h.atrasados.length === 0)
        l.push('Nenhum: todos os setores com a meta vencida já passaram a este sistema.', '');
      else {
        l.push(
          'A coexistência destes setores se prolonga, sem parar o hospital; a nova data é uma proposta que o dono revê.',
          '',
        );
        l.push(linhaTabela(['setor', 'onda', 'situação', 'meta', 'nova data proposta']));
        l.push(linhaTabela(['---', '---', '---', '---', '---']));
        for (const s of h.atrasados)
          l.push(linhaTabela([s.nome, s.onda, SITUACAO[s.situacao] ?? s.situacao, s.meta, s.novaData]));
        l.push('');
      }
    }
    l.push('### Chamados', '');
    if (h.chamados.every((c) => c.abertos + c.resolvidos === 0)) l.push('Nenhum chamado no período.', '');
    else {
      l.push(linhaTabela(['severidade', 'abertos', 'vencidos', 'resolvidos']));
      l.push(linhaTabela(['---', '---', '---', '---']));
      for (const c of h.chamados)
        l.push(
          linhaTabela([
            c.severidade,
            contagemSegura(c.abertos),
            contagemSegura(c.vencidos),
            contagemSegura(c.resolvidos),
          ]),
        );
      l.push('');
    }
    if (d.periodo === 'semana' || h.carga) {
      l.push('### Carga do banco', '');
      if (!h.carga) l.push('Sem leitura da carga no período.', '');
      else
        l.push(
          `Conexões por sistema: ${h.carga.conexoesPorSistema.map((c) => `${c.sistema} ${c.conexoes}`).join('; ') || 'nenhuma'}; transações longas: ${h.carga.transacoesLongas}.`,
          '',
        );
    }
  }
  l.push('## Decisões e pendências', '');
  if (d.decisoes.length === 0) l.push('Nenhuma decisão pendente registrada.', '');
  else
    for (const x of d.decisoes)
      l.push(
        `- ${x.id}: ${x.assunto}${x.prazo ? ` (prazo ${x.prazo}${x.vencendo ? ', vencendo' : ''})` : ''}.`,
      );
  l.push('');
  return l.join('\n');
}
