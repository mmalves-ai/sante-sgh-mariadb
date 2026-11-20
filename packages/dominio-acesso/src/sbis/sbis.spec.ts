import { CONCESSOES_COEXISTENCIA, type ItemCicloSbis, REQUISITOS_SBIS } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { situacaoBackup, situacaoRestauracao } from './backup.js';
import {
  aplicarAvaliacao,
  certificadoVigente,
  type CicloRegra,
  competenciaDe,
  fase5Pronta,
  itensIniciais,
  parecerDosItens,
  recusaAbrirCiclo,
  recusaAuditoriaFormal,
  recusaAvaliarItem,
  recusaCancelarCiclo,
  recusaConcluirCiclo,
  recusaCorrigirItem,
  recusaVerificarItem,
  requisitoSbis,
  resumirItens,
} from './ciclos.js';
import {
  concessoesVigentes,
  painelConcessoes,
  recusaEncerrarConcessao,
  recusaReabrirConcessao,
  type RegistroConcessao,
} from './concessoes.js';
import { contagemRequisitos, montarPacote, ROTEIRO_PENDENTE, type EntradasPacote } from './pacote.js';
import { camposIdentificacao, camposProva, diasDoPeriodo, provaDaCadeia, rfc3339 } from './trilha.js';

const LIGADO = { desligado: false, contingenciaAtiva: true };
const CONTINGENCIA = { desligado: true, contingenciaAtiva: true };
const PRONTO = { desligado: true, contingenciaAtiva: false };
const ATENDIDO = { indicador: 'atendido' as const, medida: '0 pendente' };

const encerrada = (codigo: RegistroConcessao['codigo']): RegistroConcessao => ({
  codigo,
  situacao: 'encerrada',
  fimPrevisto: '2027-01-31',
  evidencia: 'Relatório do endurecimento',
  encerradaPor: 'SINT.AUDITOR',
  encerradaEm: '2027-02-01T12:00:00.000Z',
  reabertaPor: null,
  reabertaEm: null,
  motivoReabertura: null,
});

describe('concessões da coexistência (regra 1; cap-13 §13.2.1)', () => {
  it('encerra só com o desligamento, sem contingência e com o indicador atendido', () => {
    expect(recusaEncerrarConcessao(null, LIGADO, ATENDIDO)).toBe('sistema-anterior-ligado');
    expect(recusaEncerrarConcessao(null, CONTINGENCIA, ATENDIDO)).toBe('contingencia-ativa');
    expect(recusaEncerrarConcessao(null, PRONTO, { indicador: 'pendente', medida: '' })).toBe(
      'indicador-pendente',
    );
    expect(recusaEncerrarConcessao(null, PRONTO, { indicador: 'indisponivel', medida: '' })).toBe(
      'indicador-indisponivel',
    );
    expect(recusaEncerrarConcessao(null, PRONTO, ATENDIDO)).toBeNull();
    expect(recusaEncerrarConcessao(encerrada('privilegio-banco'), PRONTO, ATENDIDO)).toBe(
      'concessao-ja-encerrada',
    );
  });

  it('reabre só a encerrada', () => {
    expect(recusaReabrirConcessao(null)).toBe('concessao-ja-vigente');
    expect(recusaReabrirConcessao(encerrada('trilha-alteravel'))).toBeNull();
  });

  it('painel com as seis concessões na ordem, medida ausente vira indisponível', () => {
    const p = painelConcessoes(
      'pc',
      [encerrada('privilegio-banco')],
      { 'senha-formato-antigo': ATENDIDO },
      PRONTO,
    );
    expect(p.concessoes.map((c) => c.codigo)).toEqual([...CONCESSOES_COEXISTENCIA]);
    expect(p.encerradas).toBe(1);
    expect(p.vigentes).toBe(5);
    const senha = p.concessoes.find((c) => c.codigo === 'senha-formato-antigo');
    expect(senha?.recusa).toBeNull();
    expect(senha?.requisitos).toContain('SBIS-03');
    const trilha = p.concessoes.find((c) => c.codigo === 'trilha-alteravel');
    expect(trilha?.indicador).toBe('indisponivel');
    expect(trilha?.recusa).toBe('indicador-indisponivel');
    expect(p.concessoes.find((c) => c.codigo === 'privilegio-banco')?.recusa).toBeNull();
    expect(concessoesVigentes([encerrada('privilegio-banco')]).has('privilegio-banco')).toBe(false);
    expect(concessoesVigentes([]).size).toBe(6);
  });
});

const ciclo = (c: Partial<CicloRegra> = {}): CicloRegra => ({
  id: '1',
  tipo: 'autoavaliacao',
  competencia: '2027-02',
  situacao: 'aberto',
  parecer: null,
  certificado: null,
  concluidoEm: null,
  ...c,
});

const preApta = ciclo({ id: '9', tipo: 'pre-auditoria', situacao: 'concluido', parecer: 'apto' });
const ctx = {
  ciclos: [] as CicloRegra[],
  situacao: PRONTO,
  concessoesVigentes: 0,
  fase5Liberada: true,
  competencia: '2027-02',
};

describe('abertura dos ciclos (regra 9; cap-13 §13.6.2)', () => {
  it('autoavaliação: uma aberta por vez e uma concluída por mês, mesmo com o outro sistema ligado', () => {
    expect(
      recusaAbrirCiclo({ tipo: 'autoavaliacao', versao: '1.0' }, { ...ctx, situacao: LIGADO }),
    ).toBeNull();
    expect(recusaAbrirCiclo({ tipo: 'autoavaliacao', versao: '1.0' }, { ...ctx, ciclos: [ciclo()] })).toBe(
      'ciclo-aberto-do-tipo',
    );
    const feita = ciclo({ situacao: 'concluido' });
    expect(recusaAbrirCiclo({ tipo: 'autoavaliacao', versao: '1.0' }, { ...ctx, ciclos: [feita] })).toBe(
      'autoavaliacao-do-mes',
    );
    expect(
      recusaAbrirCiclo(
        { tipo: 'autoavaliacao', versao: '1.0' },
        { ...ctx, ciclos: [feita], competencia: '2027-03' },
      ),
    ).toBeNull();
  });

  it('pré-auditoria pede o avaliador e o desligamento', () => {
    expect(recusaAbrirCiclo({ tipo: 'pre-auditoria', versao: '1.0' }, ctx)).toBe('avaliador-obrigatorio');
    expect(recusaAbrirCiclo({ tipo: 'pre-auditoria', versao: '1.0', avaliador: '  ' }, ctx)).toBe(
      'avaliador-obrigatorio',
    );
    expect(
      recusaAbrirCiclo(
        { tipo: 'pre-auditoria', versao: '1.0', avaliador: 'Consultoria' },
        { ...ctx, situacao: LIGADO },
      ),
    ).toBe('sistema-anterior-ligado');
    expect(
      recusaAbrirCiclo({ tipo: 'pre-auditoria', versao: '1.0', avaliador: 'Consultoria' }, ctx),
    ).toBeNull();
  });

  it('auditoria formal: desligado, sem concessão, Fase 5 pronta e pré-auditoria apta', () => {
    const p = { tipo: 'auditoria' as const, versao: '1.0', avaliador: 'SBIS' };
    expect(recusaAbrirCiclo(p, { ...ctx, situacao: LIGADO })).toBe('sistema-anterior-ligado');
    expect(recusaAbrirCiclo(p, { ...ctx, concessoesVigentes: 2 })).toBe('concessoes-vigentes');
    expect(recusaAbrirCiclo(p, { ...ctx, fase5Liberada: false })).toBe('fase5-pendente');
    expect(recusaAbrirCiclo(p, ctx)).toBe('auditoria-sem-pre-auditoria');
    expect(recusaAbrirCiclo(p, { ...ctx, ciclos: [preApta] })).toBeNull();
    expect(recusaAuditoriaFormal({ ...ctx, ciclos: [{ ...preApta, parecer: 'com-bloqueante' }] })).toBe(
      'auditoria-sem-pre-auditoria',
    );
  });

  it('competência e requisito do catálogo', () => {
    expect(competenciaDe('2027-02-15')).toBe('2027-02');
    expect(requisitoSbis('SBIS-03')?.concessao).toBe('senha-formato-antigo');
    expect(requisitoSbis('XYZ')).toBeNull();
    expect(itensIniciais()).toHaveLength(REQUISITOS_SBIS.length);
    expect(itensIniciais().every((i) => i.resultado === 'pendente')).toBe(true);
  });
});

const item = (codigo: string): ItemCicloSbis => {
  const i = itensIniciais().find((x) => x.requisito === codigo);
  if (!i) throw new Error(codigo);
  return i;
};
const vigentes = new Set(CONCESSOES_COEXISTENCIA);

describe('avaliação dos requisitos', () => {
  it('concessão só na autoavaliação e só com a concessão do requisito vigente', () => {
    const p = { resultado: 'concessao' as const };
    expect(recusaAvaliarItem(ciclo(), 'SBIS-03', p, vigentes)).toBeNull();
    expect(recusaAvaliarItem(ciclo(), 'SBIS-03', p, new Set())).toBe('concessao-encerrada');
    expect(recusaAvaliarItem(ciclo(), 'SBIS-01', p, vigentes)).toBe('concessao-encerrada');
    expect(recusaAvaliarItem(ciclo({ tipo: 'pre-auditoria' }), 'SBIS-03', p, vigentes)).toBe(
      'concessao-fora-da-autoavaliacao',
    );
  });

  it('não conformidade pede severidade, origem e evidência; conforme, a evidência; não aplicável, a observação', () => {
    const c = ciclo();
    expect(
      recusaAvaliarItem(c, 'SBIS-01', { resultado: 'nao-conforme', severidade: 'maior' }, vigentes),
    ).toBe('nc-sem-severidade');
    expect(
      recusaAvaliarItem(
        c,
        'SBIS-01',
        { resultado: 'nao-conforme', severidade: 'maior', origem: 'defeito' },
        vigentes,
      ),
    ).toBe('evidencia-obrigatoria');
    expect(
      recusaAvaliarItem(
        c,
        'SBIS-01',
        {
          resultado: 'nao-conforme',
          severidade: 'maior',
          origem: 'defeito',
          evidencia: 'falta a versão no CSV',
        },
        vigentes,
      ),
    ).toBeNull();
    expect(recusaAvaliarItem(c, 'SBIS-01', { resultado: 'conforme', evidencia: ' ' }, vigentes)).toBe(
      'evidencia-obrigatoria',
    );
    expect(
      recusaAvaliarItem(c, 'SBIS-01', { resultado: 'conforme', evidencia: 'roteiro 01' }, vigentes),
    ).toBeNull();
    expect(recusaAvaliarItem(c, 'SBIS-01', { resultado: 'nao-aplicavel' }, vigentes)).toBe(
      'evidencia-obrigatoria',
    );
    expect(
      recusaAvaliarItem(c, 'SBIS-01', { resultado: 'nao-aplicavel', observacao: 'fora do escopo' }, vigentes),
    ).toBeNull();
    expect(recusaAvaliarItem(c, 'NAO-EXISTE', { resultado: 'conforme', evidencia: 'x' }, vigentes)).toBe(
      'requisito-desconhecido',
    );
    expect(
      recusaAvaliarItem(ciclo({ situacao: 'concluido' }), 'SBIS-01', { resultado: 'conforme' }, vigentes),
    ).toBe('ciclo-fechado');
  });

  it('aplicar abre a correção da não conformidade e limpa a anterior', () => {
    const nc = aplicarAvaliacao(
      item('SBIS-05'),
      { resultado: 'nao-conforme', severidade: 'bloqueante', origem: 'defeito', evidencia: ' sem bloqueio ' },
      'SINT.AUDITOR',
      '2027-02-01T10:00:00.000Z',
    );
    expect(nc).toMatchObject({ correcao: 'aberta', severidade: 'bloqueante', evidencia: 'sem bloqueio' });
    const conc = aplicarAvaliacao(nc, { resultado: 'concessao' }, 'SINT.AUDITOR', '2027-02-02T10:00:00.000Z');
    expect(conc).toMatchObject({ correcao: null, severidade: null, origem: 'concessao', evidencia: null });
    const conf = aplicarAvaliacao(
      nc,
      { resultado: 'conforme', evidencia: 'ok' },
      'X',
      '2027-02-02T10:00:00.000Z',
    );
    expect(conf.origem).toBeNull();
  });

  it('correção por uma pessoa, verificação por outra', () => {
    const c = ciclo();
    const nc = aplicarAvaliacao(
      item('SBIS-05'),
      { resultado: 'nao-conforme', severidade: 'bloqueante', origem: 'defeito', evidencia: 'x' },
      'A',
      '2027-02-01T10:00:00.000Z',
    );
    expect(recusaCorrigirItem(c, item('SBIS-05'))).toBe('item-nao-conforme');
    expect(recusaCorrigirItem(c, nc)).toBeNull();
    expect(recusaCorrigirItem(ciclo({ situacao: 'cancelado' }), nc)).toBe('ciclo-fechado');
    expect(recusaVerificarItem(c, nc, 'B')).toBe('correcao-nao-corrigida');
    const corrigida: ItemCicloSbis = { ...nc, correcao: 'corrigida', corrigidoPor: 'A' };
    expect(recusaCorrigirItem(c, corrigida)).toBe('correcao-nao-aberta');
    expect(recusaVerificarItem(c, corrigida, 'A')).toBe('verificador-igual');
    expect(recusaVerificarItem(c, corrigida, 'B')).toBeNull();
    expect(recusaVerificarItem(c, item('SBIS-01'), 'B')).toBe('item-nao-conforme');
    expect(recusaVerificarItem(ciclo({ situacao: 'concluido' }), corrigida, 'B')).toBe('ciclo-fechado');
    // A NC só se reavalia com a correção verificada por outra pessoa (D-CICLOS-F5).
    const v = new Set<never>();
    const conforme = { resultado: 'conforme', evidencia: 'ok' } as const;
    expect(recusaAvaliarItem(c, 'SBIS-05', conforme, v, nc)).toBe('nc-sem-verificacao');
    expect(recusaAvaliarItem(c, 'SBIS-05', conforme, v, corrigida)).toBe('nc-sem-verificacao');
    expect(recusaAvaliarItem(c, 'SBIS-05', conforme, v, { ...corrigida, correcao: 'verificada' })).toBeNull();
    expect(recusaAvaliarItem(c, 'SBIS-05', conforme, v, item('SBIS-05'))).toBeNull();
  });
});

describe('conclusão, parecer e certificado (regra 9; SBIS-42)', () => {
  const avaliados = (): ItemCicloSbis[] =>
    itensIniciais().map((i) => aplicarAvaliacao(i, { resultado: 'conforme', evidencia: 'ok' }, 'A', 'x'));

  it('resumo conta lacunas por origem e as bloqueantes sem verificação', () => {
    const itens = avaliados();
    itens[0] = {
      ...itens[0]!,
      resultado: 'nao-conforme',
      severidade: 'bloqueante',
      origem: 'defeito',
      correcao: 'corrigida',
    };
    itens[1] = {
      ...itens[1]!,
      resultado: 'nao-conforme',
      severidade: 'menor',
      origem: 'documentacao',
      correcao: 'aberta',
    };
    itens[2] = { ...itens[2]!, resultado: 'concessao', origem: 'concessao' };
    const r = resumirItens(itens);
    expect(r).toMatchObject({
      'nao-conforme': 2,
      concessao: 1,
      bloqueantesAbertas: 1,
      defeitos: 1,
      pendente: 0,
    });
    expect(parecerDosItens(itens)).toBe('com-bloqueante');
    itens[0] = { ...itens[0], correcao: 'verificada' };
    expect(parecerDosItens(itens)).toBe('apto');
  });

  it('conclui sem pendência; certificado só na auditoria apta, e obrigatório nela', () => {
    expect(recusaConcluirCiclo(ciclo(), itensIniciais(), {})).toBe('itens-pendentes');
    expect(recusaConcluirCiclo(ciclo(), avaliados(), {})).toBeNull();
    expect(recusaConcluirCiclo(ciclo(), avaliados(), { certificado: 'SBIS-123' })).toBe(
      'certificado-so-na-auditoria',
    );
    const aud = ciclo({ tipo: 'auditoria' });
    expect(recusaConcluirCiclo(aud, avaliados(), {})).toBe('certificado-obrigatorio');
    expect(recusaConcluirCiclo(aud, avaliados(), { certificado: 'SBIS-123' })).toBeNull();
    const comNc = avaliados();
    comNc[0] = {
      ...comNc[0]!,
      resultado: 'nao-conforme',
      severidade: 'bloqueante',
      origem: 'defeito',
      correcao: 'aberta',
    };
    expect(recusaConcluirCiclo(aud, comNc, {})).toBeNull();
    expect(recusaConcluirCiclo(aud, comNc, { certificado: 'SBIS-1' })).toBe('certificado-so-na-auditoria');
    expect(recusaConcluirCiclo(ciclo({ situacao: 'concluido' }), avaliados(), {})).toBe('ciclo-fechado');
    expect(recusaCancelarCiclo(ciclo())).toBeNull();
    expect(recusaCancelarCiclo(ciclo({ situacao: 'cancelado' }))).toBe('ciclo-fechado');
  });

  it('certificado vigente: a auditoria apta mais recente', () => {
    expect(certificadoVigente([preApta])).toBeNull();
    const a1 = ciclo({
      tipo: 'auditoria',
      situacao: 'concluido',
      parecer: 'apto',
      certificado: 'N1',
      concluidoEm: '2027-03-01T00:00:00Z',
    });
    const a2 = { ...a1, certificado: 'N2', concluidoEm: '2028-03-01T00:00:00Z' };
    expect(certificadoVigente([a1, a2])).toBe('N2');
  });

  it('Fase 5 pronta só com todos os requisitos marcados conformes na pré-auditoria apta', () => {
    expect(fase5Pronta(null)).toBe(false);
    const itens = avaliados();
    expect(fase5Pronta(itens)).toBe(true);
    const f5 = REQUISITOS_SBIS.find((r) => r.fase5)!.codigo;
    expect(
      fase5Pronta(itens.map((i) => (i.requisito === f5 ? { ...i, resultado: 'nao-aplicavel' } : i))),
    ).toBe(false);
  });
});

describe('backup verificado (SBIS-13)', () => {
  const agora = new Date('2027-02-10T12:00:00.000Z');
  it('diária em dia até 26 h; mensal até 32 dias; sem integridade não conta', () => {
    const lista = [
      {
        tipo: 'diaria' as const,
        fim: '2027-02-09T13:00:00.000Z',
        resultado: 'ok' as const,
        integridade: 'ok' as const,
      },
      {
        tipo: 'diaria' as const,
        fim: '2027-02-10T06:00:00.000Z',
        resultado: 'ok' as const,
        integridade: 'nao-verificada' as const,
      },
      {
        tipo: 'mensal' as const,
        fim: '2026-12-31T00:00:00.000Z',
        resultado: 'ok' as const,
        integridade: 'ok' as const,
      },
    ];
    const d = situacaoRestauracao('diaria', lista, agora);
    expect(d).toMatchObject({ emDia: true, ultimaComSucesso: '2027-02-09T13:00:00.000Z', falhasRecentes: 1 });
    const s = situacaoBackup(lista, agora);
    expect(s.mensal.emDia).toBe(false);
    expect(s.alertas).toHaveLength(2);
    expect(situacaoBackup([], agora).diaria).toMatchObject({ emDia: false, ultimaComSucesso: null });
    expect(situacaoRestauracao('diaria', lista, new Date('2027-02-11T00:00:00.000Z')).emDia).toBe(false);
  });
});

describe('pacote de evidências (regra 10)', () => {
  const base: EntradasPacote = {
    ambiente: 'homologacao',
    trilhaIntegra: true,
    limiteTentativas: 5,
    inatividadeSegundos: 900,
    segundoFatorCriticos: true,
    diariaEmDia: true,
    mensalEmDia: true,
    concessoesVigentes: 0,
    assinaturaConfigurada: true,
  };
  it('tudo medido pronto; o resto gerado no CI; o roteiro filmado pendente com o motivo (POL-3)', () => {
    const p = montarPacote(base);
    expect(p).toHaveLength(10);
    expect(p.filter((i) => i.situacao === 'gerado-no-ci').map((i) => i.item)).toEqual([
      'comunicacao-segura',
      'documentacao',
      'matriz-rastreabilidade',
    ]);
    expect(p.filter((i) => i.situacao === 'pendente').map((i) => [i.item, i.detalhe])).toEqual([
      ['roteiro-demonstracao', ROTEIRO_PENDENTE],
    ]);
    expect(p.find((i) => i.item === 'trilha-exportada')?.requisitos).toContain('SBIS-16');
  });
  it('pendências com o motivo', () => {
    const p = montarPacote({
      ...base,
      ambiente: 'producao',
      trilhaIntegra: false,
      limiteTentativas: 20,
      inatividadeSegundos: null,
      segundoFatorCriticos: null,
      diariaEmDia: false,
      concessoesVigentes: 2,
      assinaturaConfigurada: false,
    });
    const d = (k: string) => p.find((i) => i.item === k);
    expect(d('ambiente-testes')?.situacao).toBe('pendente');
    expect(d('trilha-exportada')?.detalhe).toContain('quebra');
    expect(d('configuracao-seguranca')?.detalhe).toContain('tentativas');
    expect(d('configuracao-seguranca')?.detalhe).toContain('inatividade');
    expect(d('restauracao-backup')?.detalhe).toBe('Em atraso: diária.');
    expect(d('fim-concessoes')?.situacao).toBe('pendente');
    expect(d('assinaturas')?.situacao).toBe('pendente');
    const n = montarPacote({
      ...base,
      trilhaIntegra: null,
      assinaturaConfigurada: null,
      limiteTentativas: null,
    });
    expect(n.find((i) => i.item === 'trilha-exportada')?.detalhe).toContain('não foi verificada');
    expect(n.find((i) => i.item === 'assinaturas')?.detalhe).toContain('não foi conferida');
    expect(n.find((i) => i.item === 'configuracao-seguranca')?.situacao).toBe('pendente');
  });
  it('contagem do catálogo', () => {
    const c = contagemRequisitos();
    expect(c.total).toBe(REQUISITOS_SBIS.length);
    expect(c.porNivel.NGS1 + c.porNivel.ECF + c.porNivel.NGS2).toBe(c.total);
    expect(c.fase5).toBeGreaterThan(0);
    expect(new Set(REQUISITOS_SBIS.map((r) => r.codigo)).size).toBe(c.total);
    expect(REQUISITOS_SBIS.filter((r) => r.regime === 'concessao').every((r) => r.concessao)).toBe(true);
  });
});

describe('prova da trilha (SBIS-16 a 19, 21)', () => {
  it('dias do período com teto', () => {
    expect(diasDoPeriodo('2027-01-30', '2027-02-02', 31)).toEqual([
      '2027-01-30',
      '2027-01-31',
      '2027-02-01',
      '2027-02-02',
    ]);
    expect(diasDoPeriodo('2027-01-01', '2027-12-31', 31)).toHaveLength(31);
    expect(diasDoPeriodo('2027-02-02', '2027-02-01', 31)).toEqual([]);
    expect(diasDoPeriodo('x', '2027-02-01', 31)).toEqual([]);
  });
  it('prova íntegra ou com o primeiro dia quebrado', () => {
    expect(provaDaCadeia([{ dia: '2027-01-01', linhas: 3, ok: true, quebraEm: null }])).toEqual({
      dias: 1,
      eventos: 3,
      integra: true,
      quebraDia: null,
      quebraEm: null,
    });
    const q = provaDaCadeia([
      { dia: '2027-01-01', linhas: 3, ok: true, quebraEm: null },
      { dia: '2027-01-02', linhas: 1, ok: false, quebraEm: '77' },
    ]);
    expect(q).toMatchObject({ integra: false, quebraDia: '2027-01-02', quebraEm: '77', eventos: 4 });
    expect(camposProva(q).find(([k]) => k === 'cadeiaIntegra')?.[1]).toBe('nao');
    expect(camposProva(provaDaCadeia([])).find(([k]) => k === 'quebraDia')?.[1]).toBe('');
  });
  it('RFC 3339 com fuso e milissegundos; identificação completa', () => {
    expect(rfc3339(new Date('2027-01-01T03:04:05.006Z'))).toBe('2027-01-01T00:04:05.006-03:00');
    expect(rfc3339(new Date('2027-01-01T00:00:00.000Z'), 90)).toBe('2027-01-01T01:30:00.000+01:30');
    const c = camposIdentificacao({
      software: 'Sante SGH',
      versao: '1.0',
      ambiente: 'homologacao',
      estabelecimento: null,
      cnes: '123',
      cnpj: null,
      inicio: '2027-01-01',
      fim: '2027-01-02',
      geradoEm: 'x',
      geradoPor: 'A',
    });
    expect(c.map(([k]) => k)).toContain('cnes');
    expect(c.find(([k]) => k === 'estabelecimento')?.[1]).toBe('');
  });
});
