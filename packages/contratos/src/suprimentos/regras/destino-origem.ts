// Destino e origem da saída (ficha do M28, regra 6; Anexo A; ref 02 §2.5): `DEST` 1 paciente interno, 2 centro de
// custo, 3 paciente externo, 5 terceiro; `ORIGEM` E manual, P prescrição (só a dispensação, M29), B baixa para o setor
// (confiança média: só no caso de uso visto, com a legenda "a confirmar"); I nunca usado (recusado). Paciente e conta só
// nos destinos 1 e 3; `TCE='C'` no destino 3 (confiança baixa: "a confirmar"); terceiro só no destino 5.
import { recusa, type RecusaSuprimentos } from './recusa.js';

export const DESTINOS_SAIDA = [1, 2, 3, 5] as const;
export type DestinoSaida = (typeof DESTINOS_SAIDA)[number];

export const ORIGENS_SAIDA = ['E', 'B', 'P'] as const;
export type OrigemSaida = (typeof ORIGENS_SAIDA)[number];

export const ROTULO_DESTINO: Readonly<Record<DestinoSaida, string>> = {
  1: 'Paciente internado',
  2: 'Centro de custo (setor)',
  3: 'Paciente externo',
  5: 'Terceiro',
};

export const ROTULO_ORIGEM: Readonly<Record<OrigemSaida, string>> = {
  E: 'Saída manual',
  B: 'Baixa para o setor (a confirmar)',
  P: 'Prescrição (dispensação)',
};

/** Códigos de baixa confiança: gravados só com os valores já vistos e com a legenda "a confirmar". */
export const A_CONFIRMAR = { origemB: true, tce: true } as const;

export interface CabecalhoSaida {
  readonly destino: number;
  readonly origem: string;
  readonly paciente?: number | null;
  readonly conta?: number | null;
  readonly terceiro?: string | null;
}

/** Saída do novo (M28): só E e B; P é da dispensação (M29); I nunca. */
export function conferirDestinoOrigem(
  c: CabecalhoSaida,
  o: { dispensacao?: boolean } = {},
): RecusaSuprimentos[] {
  const r: RecusaSuprimentos[] = [];
  if (!(DESTINOS_SAIDA as readonly number[]).includes(c.destino))
    r.push(
      recusa(
        'destino-invalido',
        'Escolha o destino: paciente internado, setor, paciente externo ou terceiro.',
        ['destino'],
      ),
    );
  if (c.origem === 'I' || !(ORIGENS_SAIDA as readonly string[]).includes(c.origem))
    r.push(recusa('origem-invalida', 'Origem da saída não usada neste estabelecimento.', ['origem']));
  else if (c.origem === 'P' && !o.dispensacao)
    r.push(
      recusa('origem-da-dispensacao', 'A saída por prescrição é feita pela dispensação da farmácia.', [
        'origem',
      ]),
    );
  else if (c.origem === 'B' && c.destino !== 2)
    r.push(recusa('origem-baixa-so-setor', 'A baixa para o setor só vale para o destino setor.', ['origem']));
  const comPaciente = c.destino === 1 || c.destino === 3;
  if (comPaciente && !(c.paciente && c.paciente > 0))
    r.push(recusa('sem-paciente', 'Informe o atendimento do paciente.', ['paciente']));
  if (!comPaciente && (c.paciente || c.conta))
    r.push(recusa('paciente-fora-do-destino', 'Paciente e conta só na saída a paciente.', ['paciente']));
  if (c.destino === 5 && !(c.terceiro ?? '').trim())
    r.push(recusa('sem-terceiro', 'Informe o terceiro que recebe a saída.', ['terceiro']));
  if (c.destino !== 5 && (c.terceiro ?? '').trim())
    r.push(recusa('terceiro-fora-do-destino', 'Terceiro só na saída a terceiro.', ['terceiro']));
  return r;
}

/** O que o cabeçalho grava por destino (colunas do outro sistema, como o perfil mostra). */
export function colunasDoDestino(c: CabecalhoSaida): {
  readonly PAC: number;
  readonly CONTA: number;
  readonly TCE: '' | 'C';
  readonly TERCEIRO: string;
  readonly atendimento: 'I' | 'E' | null;
} {
  const pac = c.destino === 1 || c.destino === 3 ? (c.paciente ?? 0) : 0;
  return {
    PAC: pac,
    CONTA: c.destino === 1 || c.destino === 3 ? (c.conta ?? 0) : 0,
    TCE: c.destino === 3 ? 'C' : '',
    TERCEIRO: c.destino === 5 ? (c.terceiro ?? '').trim().slice(0, 45) : '',
    atendimento: c.destino === 1 ? 'I' : c.destino === 3 ? 'E' : null,
  };
}
