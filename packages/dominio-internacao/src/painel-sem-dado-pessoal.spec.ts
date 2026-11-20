// Regra 16: o painel não leva dado pessoal desnecessário. O cartão tem só iniciais, idade, sexo, dias e convênio:
// nenhuma chave de nome, documento, nascimento, telefone ou reserva, nem o prontuário.
import { iniciaisDoNome } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { em } from './massa.spec-util.js';
import { montarPainel } from './painel.js';
import { leituras } from './painel.spec-util.js';

const PROIBIDAS =
  /nome(?!s)|cpf|nasc|telefone|fone|reserva|senha|prontuario|paciente|matricula|endereco|mae/i;

function chaves(v: unknown, prefixo = ''): string[] {
  if (Array.isArray(v)) return v.flatMap((x) => chaves(x, prefixo));
  if (v && typeof v === 'object')
    return Object.entries(v).flatMap(([k, x]) => [`${prefixo}${k}`, ...chaves(x, `${prefixo}${k}.`)]);
  return [];
}

describe('painel sem dado pessoal', () => {
  const p = montarPainel(leituras(), {
    intensivas: [3],
    agora: em('2026-10-21', '1000'),
    lidoEm: 'x',
    dadosAte: 'x',
    destino: 'memoria',
  });

  it('o cartão só tem as chaves permitidas', () => {
    const cartao = p.blocos[0]?.acomodacoes[0]?.leitos[0]?.cartao;
    expect(Object.keys(cartao ?? {}).sort()).toEqual(
      [
        'convenio',
        'diasInternacao',
        'idade',
        'iniciais',
        'internacao',
        'intensivo',
        'sexo',
        'tipoTrecho',
      ].sort(),
    );
    // O nome da acomodação e do bloco são cadastros, não pessoa.
    const pessoais = chaves(p).filter(
      (k) =>
        PROIBIDAS.test(k.split('.').at(-1) ?? '') &&
        !/^blocos\.(nome|acomodacoes\.nome|acomodacoes\.tipo\.nome|acomodacoes\.leitos\.cartao\.tipoTrecho\.nome)$/.test(
          k,
        ),
    );
    expect(pessoais).toEqual([]);
  });

  it('as iniciais nunca deixam o nome passar', () => {
    expect(iniciaisDoNome('MARIA DA SILVA OLIVEIRA')).toBe('MSO');
    expect(iniciaisDoNome('ana  de souza')).toBe('AS');
    expect(iniciaisDoNome('JOSÉ ÂNGELO DOS ÉDEN PEREIRA CORRÊA SANTOS')).toBe('JÂCS');
    expect(iniciaisDoNome(null)).toBe('');
  });
});
