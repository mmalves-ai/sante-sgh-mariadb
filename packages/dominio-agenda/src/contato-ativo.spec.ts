import { describe, expect, it } from 'vitest';
import {
  decidirContato,
  type EntradaDecisaoContato,
  type ItemFilaContato,
  LIMITE_TENTATIVAS_CONTATO,
  ordemFilaContato,
  validarProgramacaoContato,
} from './contato-ativo.js';

const agora = new Date('2030-03-10T12:00:00Z');
const amanha = new Date('2030-03-11T12:00:00Z');
const R = {
  confirmou: {
    codigo: 'confirmou',
    sucesso: true,
    encerraTentativas: true,
    efeitoMarcacao: 'confirmar' as const,
  },
  desistiu: {
    codigo: 'desistiu',
    sucesso: true,
    encerraTentativas: true,
    efeitoMarcacao: 'cancelar' as const,
  },
  naoAtendeu: { codigo: 'nao_atendeu', sucesso: false, encerraTentativas: false, efeitoMarcacao: null },
  numeroErrado: { codigo: 'numero_errado', sucesso: false, encerraTentativas: true, efeitoMarcacao: null },
};
const base = (x: Partial<EntradaDecisaoContato> = {}): EntradaDecisaoContato => ({
  canal: 'telefone',
  motivo: 'confirmacao_marcacao',
  contatoEm: agora,
  agora,
  resultado: R.confirmou,
  marcacao: { significado: 'aguardando', inicioEm: amanha },
  tentativasAnteriores: 0,
  podeCancelar: true,
  ...x,
});

describe('decidirContato', () => {
  it('confirma a marcação aguardando quando o paciente confirma', () => {
    expect(decidirContato(base())).toEqual({
      ok: true,
      situacao: 'realizado',
      efeito: 'confirmar',
      novaTentativaEm: null,
      alertas: [],
    });
  });

  it('a marcação já confirmada só registra o contato', () => {
    const d = decidirContato(base({ marcacao: { significado: 'confirmada', inicioEm: amanha } }));
    expect(d.ok && d.efeito).toBe(null);
    expect(d.ok && d.alertas.length).toBe(1);
  });

  it('a desistência cancela, mas exige a permissão de cancelar e consulta futura', () => {
    expect(decidirContato(base({ resultado: R.desistiu }))).toMatchObject({ ok: true, efeito: 'cancelar' });
    expect(decidirContato(base({ resultado: R.desistiu, podeCancelar: false }))).toMatchObject({
      ok: false,
      codigo: 'sem-permissao-cancelar',
    });
    expect(
      decidirContato(
        base({ resultado: R.desistiu, marcacao: { significado: 'aguardando', inicioEm: agora } }),
      ),
    ).toMatchObject({ ok: false, codigo: 'consulta-passou' });
    expect(
      decidirContato(
        base({ resultado: R.desistiu, marcacao: { significado: 'cancelada', inicioEm: amanha } }),
      ),
    ).toMatchObject({ ok: false, codigo: 'marcacao-encerrada' });
  });

  it('sem sucesso programa a próxima tentativa até o limite e antes da consulta', () => {
    const d = decidirContato(base({ resultado: R.naoAtendeu }));
    expect(d).toMatchObject({ ok: true, situacao: 'sem_sucesso', efeito: null });
    expect(d.ok && d.novaTentativaEm?.toISOString()).toBe('2030-03-10T16:00:00.000Z');
    const ultima = decidirContato(
      base({ resultado: R.naoAtendeu, tentativasAnteriores: LIMITE_TENTATIVAS_CONTATO - 1 }),
    );
    expect(ultima.ok && ultima.novaTentativaEm).toBe(null);
    expect(ultima.ok && ultima.alertas[0]).toMatch(/Tentativas encerradas \(3 de 3\)/);
    const perto = decidirContato(
      base({
        resultado: R.naoAtendeu,
        marcacao: { significado: 'aguardando', inicioEm: new Date('2030-03-10T14:00:00Z') },
      }),
    );
    expect(perto.ok && perto.novaTentativaEm).toBe(null);
    const errado = decidirContato(base({ resultado: R.numeroErrado }));
    expect(errado.ok && errado.novaTentativaEm).toBe(null);
  });

  it('recusa canal, motivo, data no futuro e efeito sem marcação', () => {
    expect(decidirContato(base({ canal: 'pombo' }))).toMatchObject({ codigo: 'canal-invalido' });
    expect(decidirContato(base({ motivo: 'x' }))).toMatchObject({ codigo: 'motivo-invalido' });
    expect(decidirContato(base({ contatoEm: new Date(agora.getTime() + 3_600_000) }))).toMatchObject({
      codigo: 'contato-no-futuro',
    });
    expect(decidirContato(base({ marcacao: null }))).toMatchObject({ codigo: 'motivo-exige-marcacao' });
    expect(decidirContato(base({ marcacao: null, motivo: 'busca_ativa' }))).toMatchObject({
      codigo: 'efeito-sem-marcacao',
    });
  });
});

describe('fila e programação', () => {
  it('ordena resposta negativa, contato devido, consulta mais próxima', () => {
    const i = (x: Partial<ItemFilaContato>): ItemFilaContato => ({
      inicioEm: amanha,
      respostaNegativa: false,
      contatoDevido: false,
      tentativas: 0,
      ...x,
    });
    const lista = [i({ inicioEm: agora }), i({ contatoDevido: true }), i({ respostaNegativa: true })];
    const ord = [...lista].sort(ordemFilaContato);
    expect(ord.map((x) => (x.respostaNegativa ? 'n' : x.contatoDevido ? 'd' : 'p'))).toEqual(['n', 'd', 'p']);
  });

  it('valida a programação na hora', () => {
    const ok = { canal: 'telefone', motivo: 'lembrete', programadoPara: amanha, agora };
    expect(validarProgramacaoContato(ok)).toBe(null);
    expect(validarProgramacaoContato({ ...ok, programadoPara: new Date('2030-03-09T00:00:00Z') })).toMatch(
      /agora ou depois/,
    );
    expect(validarProgramacaoContato({ ...ok, canal: '' })).toMatch(/canal/);
  });
});
