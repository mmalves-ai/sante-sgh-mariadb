// Pulseira e código da dose (ficha do M25, regras 4 e 5; cap-05b §5.8 "Pulseira"). A pulseira de identificação
// impressa pela recepção e pela internação leva o código bidimensional `P<paciente>|A<atendimento>` (M20). Em unidade
// com a leitura ligada, checar sem ler a pulseira exige o motivo (vai para a trilha e para o indicador); a pulseira de
// outro paciente bloqueia (paciente certo). O código da dose é o GS1 (GTIN, validade e lote) ou o código de barras do
// item do cadastro.
export interface PulseiraLida {
  readonly paciente: number;
  readonly atendimento: number | null;
}

/** Interpreta o código lido da pulseira (`P123|A456`); qualquer outro formato: null. */
export function lerCodigoPulseira(codigo: string): PulseiraLida | null {
  const m = /^P(\d{1,16})(?:\|A(\d{1,16}))?$/.exec(codigo.trim().toUpperCase());
  if (!m) return null;
  const paciente = Number(m[1]);
  const atendimento = m[2] === undefined ? null : Number(m[2]);
  if (!Number.isSafeInteger(paciente) || paciente <= 0) return null;
  if (atendimento !== null && (!Number.isSafeInteger(atendimento) || atendimento <= 0)) return null;
  return { paciente, atendimento };
}

export type ResultadoPulseira =
  | { readonly ok: true; readonly lida: boolean; readonly motivo: string | null }
  | {
      readonly ok: false;
      readonly codigo: 'pulseira-outro-paciente' | 'pulseira-ilegivel' | 'pulseira-sem-motivo';
      readonly mensagem: string;
    };

/** Regra 5: a leitura da pulseira (ou o motivo de não ler) contra o paciente do horário. */
export function conferirPulseira(c: {
  readonly obrigatoria: boolean;
  readonly leitura:
    { readonly lida: true; readonly codigo: string } | { readonly lida: false; readonly motivo: string };
  readonly paciente: number;
  /** Número do atendimento (internação) do horário; com ele, a pulseira de outro atendimento também bloqueia. */
  readonly atendimento: number | null;
}): ResultadoPulseira {
  if (c.leitura.lida) {
    const p = lerCodigoPulseira(c.leitura.codigo);
    if (!p)
      return {
        ok: false,
        codigo: 'pulseira-ilegivel',
        mensagem: 'O código lido não é de uma pulseira de identificação.',
      };
    if (
      p.paciente !== c.paciente ||
      (p.atendimento !== null && c.atendimento !== null && p.atendimento !== c.atendimento)
    )
      return {
        ok: false,
        codigo: 'pulseira-outro-paciente',
        mensagem: 'A pulseira lida não é do paciente deste horário: confira o paciente antes de administrar.',
      };
    return { ok: true, lida: true, motivo: null };
  }
  const motivo = c.leitura.motivo.trim();
  if (c.obrigatoria && !motivo)
    return {
      ok: false,
      codigo: 'pulseira-sem-motivo',
      mensagem: 'Nesta unidade a leitura da pulseira é obrigatória: leia a pulseira ou informe o motivo.',
    };
  return { ok: true, lida: false, motivo: motivo || null };
}

export interface DoseLida {
  readonly gtin: string | null;
  readonly validade: string | null;
  readonly lote: string | null;
  /** Código lido que não é GS1 (o código de barras do item do cadastro). */
  readonly barras: string | null;
}

const GS = '\u001d';

/** Interpreta o código da dose: GS1 (01 GTIN, 17 validade AAMMDD, 10 lote, 21 série) ou o código de barras simples. */
export function lerCodigoDose(codigo: string): DoseLida {
  let s = codigo.trim().replace(/^\]d2|^\]C1|^\]Q3/, '');
  // O leitor em modo teclado pode trocar o separador de grupo por "|" ou "^".
  s = s.replace(/[|^]/g, GS);
  if (!/^(01\d{14}|\(01\))/.test(s)) return { gtin: null, validade: null, lote: null, barras: s || null };
  const comParenteses = s.includes('(');
  const campos = new Map<string, string>();
  if (comParenteses) {
    for (const m of s.matchAll(/\((\d{2})\)([^(]*)/g)) campos.set(m[1] as string, (m[2] ?? '').trim());
  } else {
    let i = 0;
    while (i < s.length) {
      const ai = s.slice(i, i + 2);
      i += 2;
      if (ai === '01') {
        campos.set(ai, s.slice(i, i + 14));
        i += 14;
      } else if (ai === '17' || ai === '11') {
        campos.set(ai, s.slice(i, i + 6));
        i += 6;
      } else if (ai === '10' || ai === '21') {
        const fim = s.indexOf(GS, i);
        campos.set(ai, s.slice(i, fim === -1 ? undefined : fim));
        i = fim === -1 ? s.length : fim + 1;
      } else break;
    }
  }
  const v = campos.get('17');
  let validade: string | null = null;
  if (v && /^\d{6}$/.test(v)) {
    const ano = 2000 + Number(v.slice(0, 2));
    const mes = Number(v.slice(2, 4));
    let dia = Number(v.slice(4, 6));
    // GS1: dia 00 é o último dia do mês.
    if (dia === 0) dia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
    validade = `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  }
  const gtin = campos.get('01') ?? null;
  return {
    gtin: gtin && /^\d{14}$/.test(gtin) ? gtin : null,
    validade,
    lote: campos.get('10') || null,
    barras: null,
  };
}

/** O GTIN casa com o código de barras do item (o EAN-13 é o GTIN-14 sem o zero à esquerda)? */
export function gtinCasa(gtin: string | null, barrasDoItem: string | null): boolean {
  if (!gtin || !barrasDoItem) return false;
  const a = gtin.replace(/^0+/, '');
  const b = barrasDoItem.replace(/\D/g, '').replace(/^0+/, '');
  return a.length > 0 && a === b;
}
