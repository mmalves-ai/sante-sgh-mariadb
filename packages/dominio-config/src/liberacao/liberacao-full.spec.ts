// M61 (ADR 0034): o planejador puro da liberação full na instalação.
import { RECURSOS_DESLIGADOS, recursoDesligado } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { chaveLibera, reverterLote } from './lote.js';
import {
  anteriorDaDispensaFull,
  classificarChavesFull,
  ehLoteLiberacaoFull,
  ErroLiberacaoFull,
  evidenciaDispensaFull,
  justificativaLiberacaoFull,
  lotesParaReverter,
  planejarLigarTudo,
  planejarPrerequisitosFull,
  recusaPorLinhas,
} from './liberacao-full.js';

const recursos = RECURSOS_DESLIGADOS.map((r) => r.chave);

describe('planejarLigarTudo', () => {
  it('liga a do estabelecimento e passa as específicas desligadas a herdar; ligadas e herdadas ficam', () => {
    const atuais = [
      { escopo: 'hospital' as const, valor: '*', ligada: false },
      { escopo: 'setor' as const, valor: '10', ligada: false },
      { escopo: 'grupo' as const, valor: 'MEDICO', ligada: true },
      { escopo: 'pessoa' as const, valor: 'SINT.A', ligada: false },
      { escopo: 'grupo' as const, valor: 'ENF', ligada: null },
    ];
    const plano = planejarLigarTudo(atuais);
    expect(plano).toEqual([
      { escopo: 'hospital', valor: '*', ligada: true, antes: false },
      { escopo: 'setor', valor: '10', ligada: null, antes: false },
      { escopo: 'pessoa', valor: 'SINT.A', ligada: null, antes: false },
    ]);
    // Depois do plano, a chave libera todo mundo (a permissão por login continua decidindo quem usa).
    const depois = atuais.map((a) => {
      const m = plano.find((x) => x.escopo === a.escopo && x.valor === a.valor);
      return m ? { ...a, ligada: m.ligada } : a;
    });
    expect(chaveLibera(depois, 'SINT.A', 'ENF', '10')).toBe(true);
    expect(chaveLibera(depois, 'SINT.B', 'MEDICO', undefined)).toBe(true);
    // Reversível: cada linha volta ao de antes.
    expect(reverterLote(plano)).toEqual([
      { escopo: 'hospital', valor: '*', ligada: false, antes: true },
      { escopo: 'setor', valor: '10', ligada: false, antes: null },
      { escopo: 'pessoa', valor: 'SINT.A', ligada: false, antes: null },
    ]);
  });
  it('sem linha cria a do estabelecimento; já ligada sem específica desligada: nada a fazer', () => {
    expect(planejarLigarTudo([])).toEqual([{ escopo: 'hospital', valor: '*', ligada: true, antes: null }]);
    expect(planejarLigarTudo([{ escopo: 'hospital', valor: '*', ligada: true }])).toEqual([]);
    expect(planejarLigarTudo([{ escopo: 'hospital', valor: '*', ligada: null }])[0]).toMatchObject({
      ligada: true,
      antes: null,
    });
  });
});

describe('classificarChavesFull: as listas de exceção', () => {
  const operacoes = ['cadastro.alterarPaciente', 'sadt.emitirLaudo'];
  it('em dev: nunca em massa e sem envio ficam fora; as de decisão do dono ligam (efeito só no simulador)', () => {
    const c = classificarChavesFull({ ambiente: 'dev', recursos, operacoes });
    const fora = new Map(c.excluidas.map((e) => [e.chave, e.lista]));
    expect(fora.get('entrada.utf8')).toBe('nunca-em-massa');
    expect(fora.get('integracao.classificacaoExterna')).toBe('nunca-em-massa');
    expect(fora.get('operadora.mensagens')).toBe('sem-envio-no-dev');
    expect(fora.get('integracao.mensagensPaciente')).toBe('sem-envio-no-dev');
    expect(fora.get('relatorio.envioAgendado')).toBe('sem-envio-no-dev');
    expect(fora.has('financeiro.fiscal')).toBe(false);
    expect(c.excluidas).toHaveLength(5);
    expect(c.ligar.length).toBe(recursos.length - 5 + operacoes.length);
    expect(c.ligar.filter((x) => x.tipo === 'operacao').map((x) => x.chave)).toEqual(operacoes);
  });
  it('em produção: as de decisão do dono ficam fora, salvo --incluir; nunca em massa não se inclui', () => {
    const c = classificarChavesFull({ ambiente: 'producao', recursos, operacoes });
    const fora = new Map(c.excluidas.map((e) => [e.chave, e.lista]));
    for (const k of [
      'operadora.mensagens',
      'financeiro.fiscal',
      'catalogo.cid.responsavel',
      'rede.acessoCruzado',
    ])
      expect(fora.get(k)).toBe('decisao-do-dono');
    const comFiscal = classificarChavesFull({
      ambiente: 'producao',
      recursos,
      operacoes,
      incluir: ['financeiro.fiscal'],
    });
    expect(comFiscal.ligar.some((x) => x.chave === 'financeiro.fiscal')).toBe(true);
    expect(comFiscal.incluidas).toEqual(['financeiro.fiscal']);
    expect(() =>
      classificarChavesFull({ ambiente: 'producao', recursos, operacoes, incluir: ['entrada.utf8'] }),
    ).toThrow(ErroLiberacaoFull);
    expect(() =>
      classificarChavesFull({ ambiente: 'dev', recursos, operacoes, incluir: ['financeiro.fiscal'] }),
    ).toThrow(/fora de dev\/ci/);
  });
});

describe('planejarPrerequisitosFull', () => {
  const agora = new Date('2026-10-30T15:00:00Z');
  const alvo = ['sessoes', 'faturamento.susAih', 'pessoas.esocial', 'operadora.ans'].map((k) =>
    recursoDesligado(k)!,
  );
  it('dev: tudo o que falta é dispensado; o que está em dia fica', () => {
    const p = planejarPrerequisitosFull({
      ambiente: 'dev',
      recursos: alvo,
      registrados: [{ recurso: 'operadora.ans', tipo: 'aprovacao', situacao: 'cumprido', validade: null }],
      agora,
    });
    expect(p.pendentes).toEqual([]);
    expect(p.emDia).toBe(1);
    expect(p.dispensar).toEqual(
      expect.arrayContaining([
        { recurso: 'sessoes', tipo: 'aprovacao' },
        { recurso: 'faturamento.susAih', tipo: 'contrato' },
        { recurso: 'pessoas.esocial', tipo: 'certificado' },
        { recurso: 'operadora.ans', tipo: 'certificado' },
      ]),
    );
  });
  it('produção: só a aprovação é dispensada; contrato, certificado e credenciamento ficam pendentes', () => {
    const p = planejarPrerequisitosFull({
      ambiente: 'producao',
      recursos: alvo,
      registrados: [
        { recurso: 'pessoas.esocial', tipo: 'certificado', situacao: 'cumprido', validade: '2026-10-29' },
      ],
      agora,
    });
    expect(p.dispensar.every((d) => d.tipo === 'aprovacao')).toBe(true);
    expect(p.pendentes.map((x) => `${x.recurso}:${x.tipo}`).sort()).toEqual([
      'faturamento.susAih:contrato',
      'operadora.ans:certificado',
      'pessoas.esocial:certificado', // vencido conta como falta
    ]);
  });
});

describe('reversão e limite', () => {
  it('os lotes da marca, do mais novo ao mais antigo, sem repetir', () => {
    const j = justificativaLiberacaoFull('2026-10-30', null);
    expect(ehLoteLiberacaoFull(j)).toBe(true);
    expect(ehLoteLiberacaoFull('M35: preparada')).toBe(false);
    const l = lotesParaReverter([
      { tipo: 'recurso', chave: 'a', lote: '9', justificativa: j },
      { tipo: 'recurso', chave: 'a', lote: '9', justificativa: j },
      { tipo: 'operacao', chave: 'b', lote: '120', justificativa: j },
      { tipo: 'recurso', chave: 'c', lote: '200', justificativa: 'outro lote' },
      { tipo: 'recurso', chave: 'd', lote: null, justificativa: j },
    ]);
    expect(l).toEqual([
      { tipo: 'operacao', chave: 'b', lote: '120' },
      { tipo: 'recurso', chave: 'a', lote: '9' },
    ]);
  });
  it('recusa acima de 4500 linhas', () => {
    expect(recusaPorLinhas(3000, 1000)).toBeNull();
    expect(recusaPorLinhas(3600, 979)).toMatch(/4579 linhas/);
  });
});

describe('evidência da dispensa: o registro de antes, para a reversão', () => {
  const ref = 'ESTADO.md › Autorizações 2026-10-30: liberação full na instalação (dev)';
  it('guarda e recupera situação, validade e evidência de antes', () => {
    const antes = {
      situacao: 'cumprido' as const,
      validade: '2026-01-01',
      evidencia: 'ata do setor; 12/2025',
    };
    const ev = evidenciaDispensaFull('2026-10-30', ref, antes);
    expect(ehLoteLiberacaoFull(ev)).toBe(true);
    expect(ev.length).toBeLessThanOrEqual(200);
    expect(anteriorDaDispensaFull(ev)).toEqual(antes);
    const pendente = { situacao: 'pendente' as const, validade: null, evidencia: null };
    expect(anteriorDaDispensaFull(evidenciaDispensaFull('2026-10-30', ref, pendente))).toEqual(pendente);
  });
  it('sem registro antes: null; outro formato (ou dispensa antiga): undefined', () => {
    expect(anteriorDaDispensaFull(evidenciaDispensaFull('2026-10-30', null, null))).toBeNull();
    expect(anteriorDaDispensaFull('LIBERACAO-FULL 2026-10-30; autorização: x')).toBeUndefined();
    expect(anteriorDaDispensaFull(null)).toBeUndefined();
  });
  it('evidência longa: cortada com reticências, sem passar de 200; situação e validade inteiras', () => {
    const antes = { situacao: 'cumprido' as const, validade: '2025-12-31', evidencia: 'x'.repeat(200) };
    const ev = evidenciaDispensaFull('2026-10-30', ref, antes);
    expect(ev.length).toBeLessThanOrEqual(200);
    const r = anteriorDaDispensaFull(ev);
    expect(r?.situacao).toBe('cumprido');
    expect(r?.validade).toBe('2025-12-31');
    expect(r?.evidencia?.endsWith('…')).toBe(true);
    expect(r?.evidencia?.startsWith('xxxx')).toBe(true);
  });
});

describe('W0-03: a chave agencia.completa na liberação full', () => {
  const recursos = ['agencia.transfusao', 'agencia.completa'];
  it('liga no dev e no ci (a agência completa exercitável na cópia)', () => {
    for (const ambiente of ['dev', 'ci']) {
      const c = classificarChavesFull({ ambiente, recursos, operacoes: [] });
      expect(c.ligar.map((x) => x.chave)).toContain('agencia.completa');
    }
  });
  it('em produção fica para a DP-21 (só com --incluir)', () => {
    const c = classificarChavesFull({ ambiente: 'producao', recursos, operacoes: [] });
    expect(c.excluidas.find((x) => x.chave === 'agencia.completa')).toMatchObject({
      lista: 'decisao-do-dono',
    });
    const com = classificarChavesFull({
      ambiente: 'producao',
      recursos,
      operacoes: [],
      incluir: ['agencia.completa'],
    });
    expect(com.ligar.map((x) => x.chave)).toContain('agencia.completa');
  });
});
