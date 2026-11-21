// AEJ (Arquivo Eletrônico de Jornada; Portaria MTP 671/2021, art. 83 e Anexo VI) do período fechado (M52.4; cap-07
// §7.1.3: "geração do AEJ"): texto com os campos separados por "|", um registro por linha, na ordem do leiaute:
//   01 empregador e período · 02 registradores (REP) · 03 vínculos · 04 horários contratuais · 05 marcações (E entrada,
//   S saída, D desconsiderada; fonte O original ou I incluída por ajuste) · 06 matrícula · 07 ausências e banco de
//   horas · 08 programa de tratamento do ponto · 99 trailer com as contagens.
// A versão do leiaute e os detalhes de cada campo são os confirmados com o jurídico trabalhista (cap-07, Atenção;
// D-AEJ-524): o gerador é puro e só este arquivo muda se o leiaute mudar. A assinatura digital (.p7s) é de quem envia.
import { minutoLocal } from '../escala/tempo.js';

export interface HorarioAej {
  readonly codigo: string;
  readonly duracaoMin: number;
  /** Hora em quatro dígitos, sem separador, como o leiaute do AEJ pede. */
  readonly entrada: string;
  readonly saida: string;
}

export interface MarcacaoAej {
  readonly instante: string;
  readonly rep: string | null;
  readonly tipo: 'E' | 'S' | 'D';
  readonly fonte: 'O' | 'I';
  readonly horario: string | null;
  readonly motivo: string | null;
}

export interface AusenciaAej {
  /** 1 descanso semanal descontado; 2 falta não justificada; 3 movimento do banco de horas; 4 folga de feriado. */
  readonly tipo: 1 | 2 | 3 | 4;
  readonly data: string;
  readonly minutos: number;
  /** No movimento do banco: 1 inclusão de horas; 2 compensação. */
  readonly movimentoBanco: 1 | 2 | null;
}

export interface VinculoAej {
  readonly id: string;
  readonly cpf: string;
  readonly nome: string;
  readonly matricula: string | null;
  readonly marcacoes: readonly MarcacaoAej[];
  readonly ausencias: readonly AusenciaAej[];
}

export interface DadosAej {
  readonly empregador: { readonly cnpj: string | null; readonly razaoSocial: string };
  readonly dataInicial: string;
  readonly dataFinal: string;
  readonly geradoEm: string;
  readonly reps: readonly { readonly id: string; readonly tipo: string; readonly numero: string }[];
  readonly horarios: readonly HorarioAej[];
  readonly vinculos: readonly VinculoAej[];
  readonly programa: {
    readonly nome: string;
    readonly versao: string;
    readonly cnpjDesenvolvedor: string | null;
    readonly razaoDesenvolvedor: string;
    readonly email: string;
  };
}

export const VERSAO_AEJ = '001';

const limpo = (v: string) => v.replace(/[|\r\n]/g, ' ').trim();
/** Instante local de Brasília no formato do arquivo (`AAAA-MM-DDThh:mm:00-0300`). */
export const dataHoraAej = (instante: string) => `${instante}:00-0300`;

export function gerarAej(d: DadosAej): string {
  const linhas: string[] = [];
  const conta: Record<string, number> = {};
  const reg = (tipo: string, ...campos: readonly (string | number | null)[]) => {
    conta[tipo] = (conta[tipo] ?? 0) + 1;
    linhas.push([tipo, ...campos.map((c) => (c === null ? '' : limpo(String(c))))].join('|'));
  };
  reg(
    '01',
    d.empregador.cnpj ? 1 : 2,
    d.empregador.cnpj ?? '',
    '',
    '',
    d.empregador.razaoSocial,
    d.dataInicial,
    d.dataFinal,
    dataHoraAej(d.geradoEm),
    VERSAO_AEJ,
  );
  for (const r of d.reps) reg('02', r.id, r.tipo, r.numero);
  for (const v of d.vinculos) reg('03', v.id, v.cpf, v.nome);
  for (const h of d.horarios) reg('04', h.codigo, h.duracaoMin, h.entrada, h.saida, '', '');
  for (const v of d.vinculos) {
    const ordem = [...v.marcacoes].sort((a, b) => minutoLocal(a.instante) - minutoLocal(b.instante));
    let seq = 0;
    for (const m of ordem) {
      if (m.tipo === 'E') seq++;
      reg(
        '05',
        v.id,
        dataHoraAej(m.instante),
        m.rep,
        m.tipo,
        m.tipo === 'D' ? '' : seq,
        m.fonte,
        m.horario,
        m.motivo,
      );
    }
  }
  for (const v of d.vinculos) if (v.matricula) reg('06', v.id, v.matricula);
  for (const v of d.vinculos)
    for (const a of v.ausencias) reg('07', v.id, a.tipo, a.data, a.minutos, a.movimentoBanco);
  reg(
    '08',
    d.programa.nome,
    d.programa.versao,
    d.programa.cnpjDesenvolvedor ? 1 : '',
    d.programa.cnpjDesenvolvedor,
    d.programa.razaoDesenvolvedor,
    d.programa.email,
  );
  linhas.push(
    ['99', ...['01', '02', '03', '04', '05', '06', '07', '08'].map((t) => conta[t] ?? 0)].join('|'),
  );
  return `${linhas.join('\r\n')}\r\n`;
}
