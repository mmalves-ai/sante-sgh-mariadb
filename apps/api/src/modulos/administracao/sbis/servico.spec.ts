// M59-F5: o serviço da certificação sobre a porta em memória (dados sintéticos): termo das concessões com as medidas
// das fatias F1 a F4 (falha fechada), ciclos (abrir, avaliar, corrigir, verificar por outra pessoa, concluir com o
// parecer, certificado só na auditoria apta), pacote de evidências, backup verificado e a exportação da trilha.
import {
  CONCESSOES_COEXISTENCIA,
  type DesviosPrivilegiosResposta,
  type ImutabilidadeResposta,
  type PainelSaneamento,
  type Politica2fa,
  REQUISITOS_SBIS,
  type ResumoIdentidade,
  type SegredosLegadoResposta,
} from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { ErroProblema } from '../../../problema.filter.js';
import { exportarTrilhaSbis } from './exportacao.js';
import {
  INDISPONIVEL,
  medidaPermissoes,
  medidaPrivilegio,
  medidaProntuario,
  medidaSegredos,
  medidaSenha,
  medidaTrilha,
  medirConcessoes,
  segundoFatorCriticos,
} from './medidas.js';
import { PortaSbisMemoria } from './porta-memoria.js';
import { type AtorSbis, evidenciaComMedida, ServicoSbis } from './servico.js';

const A: AtorSbis = { rede: 'r', hospital: 'pc', login: 'SINT.AUDITOR', estacao: null, correlacao: 'c' };
const B: AtorSbis = { ...A, login: 'SINT.SBIS.AUDITOR2' };
const AGORA = new Date('2027-02-15T15:00:00.000Z');
const VERSAO = {
  produto: 'Sante SGH',
  versao: '1.0.0',
  commit: 'abcdef1',
  construidoEm: '2027-02-01T00:00:00.000Z',
  identificacao: '1.0.0+abcdef1',
};

const codigo = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ErroProblema ? ((e.extras['codigo'] as string | undefined) ?? e.tipo) : String(e);
  }
};

function montar(sit = { desligado: true, contingenciaAtiva: false }, medidasOk = true) {
  const porta = new PortaSbisMemoria();
  const s = new ServicoSbis({
    porta,
    situacao: async () => sit,
    medidas: () =>
      medidasOk
        ? {
            privilegio: async () =>
              ({
                planoAplicado: true,
                excessoTotal: 0,
                faltaTotal: 0,
                versaoPlano: 'abcdefabcdef',
              }) as DesviosPrivilegiosResposta,
            prontuario: async () => ({ concessaoVigente: false }) as ImutabilidadeResposta,
          }
        : {},
    politicas2fa: async () => [{ ativa: true, onda: 1, alvo: 'perfil', inicio: '2027-01-01' } as Politica2fa],
    assinaturaConfigurada: async () => true,
    ambiente: 'homologacao',
    versao: () => VERSAO,
    agora: () => AGORA,
  });
  return { porta, s };
}

describe('termo das concessões', () => {
  it('painel com as medidas; encerra a atendida com a evidência; recusa a sem medida; reabre', async () => {
    const { porta, s } = montar();
    const p = await s.painelConcessoes(A);
    expect(p.concessoes).toHaveLength(CONCESSOES_COEXISTENCIA.length);
    expect(p.concessoes.find((c) => c.codigo === 'privilegio-banco')?.recusa).toBeNull();
    expect(p.concessoes.find((c) => c.codigo === 'trilha-alteravel')?.indicador).toBe('atendido');
    expect(p.concessoes.find((c) => c.codigo === 'senha-formato-antigo')?.recusa).toBe(
      'indicador-indisponivel',
    );
    await s.encerrarConcessao(A, 'privilegio-banco', { evidencia: 'Relatório da F1 aplicado', senha: 'x' });
    const [c] = await porta.concessoes('pc');
    expect(c?.situacao).toBe('encerrada');
    expect(c?.evidencia).toContain('Medida: Privilégio mínimo aplicado sem desvio');
    expect(
      await codigo(
        s.encerrarConcessao(A, 'privilegio-banco', { evidencia: 'de novo, outra vez', senha: 'x' }),
      ),
    ).toBe('concessao-ja-encerrada');
    expect(
      await codigo(
        s.encerrarConcessao(A, 'senha-formato-antigo', { evidencia: 'sem medida aqui', senha: 'x' }),
      ),
    ).toBe('indicador-indisponivel');
    expect(await codigo(s.reabrirConcessao(A, 'trilha-alteravel', 'motivo'))).toBe('concessao-ja-vigente');
    expect(await s.reabrirConcessao(A, 'privilegio-banco', 'contingência voltou')).toEqual({
      reaberta: true,
    });
    expect(await s.preverConcessao(A, 'privilegio-banco', '2027-03-31')).toEqual({
      fimPrevisto: '2027-03-31',
    });
    expect((await porta.concessoes('pc'))[0]?.fimPrevisto).toBe('2027-03-31');
  });

  it('com o outro sistema ligado nada encerra; a situação que não responde conta como ligado', async () => {
    const { s } = montar({ desligado: false, contingenciaAtiva: true });
    expect(
      await codigo(s.encerrarConcessao(A, 'privilegio-banco', { evidencia: 'Relatório da F1', senha: 'x' })),
    ).toBe('sistema-anterior-ligado');
    const porta = new PortaSbisMemoria();
    const s2 = new ServicoSbis({
      porta,
      situacao: async () => {
        throw new Error('fora');
      },
      ambiente: 'dev',
      versao: () => VERSAO,
    });
    expect((await s2.painelConcessoes(A)).desligado).toBe(false);
    porta.falta = ['SGH_AUDIT_CONCESSAO'];
    expect(await codigo(s2.painelConcessoes(A))).toBe('tabelas-ausentes');
  });
});

describe('ciclos de avaliação', () => {
  it('a evidência do encerramento guarda sempre a medida, mesmo com o texto no limite (D-ENCERRA-F5)', () => {
    const e = evidenciaComMedida('x'.repeat(1000), 'Privilégio mínimo aplicado sem desvio');
    expect(e).toHaveLength(1000);
    expect(e.endsWith(' | Medida: Privilégio mínimo aplicado sem desvio')).toBe(true);
    expect(evidenciaComMedida('  curto  ', 'm')).toBe('curto | Medida: m');
  });

  it('autoavaliação: abrir, avaliar, concessão vigente, corrigir, verificar por outra pessoa e concluir apto', async () => {
    const { s } = montar();
    const c = await s.abrirCiclo(A, { tipo: 'autoavaliacao', versao: '1.0.0' });
    expect(c.itens).toHaveLength(REQUISITOS_SBIS.length);
    expect(c.competencia).toBe('2027-02');
    expect(await codigo(s.abrirCiclo(A, { tipo: 'autoavaliacao', versao: '1.0.0' }))).toBe(
      'ciclo-aberto-do-tipo',
    );
    expect(await codigo(s.avaliar(A, c.id, 'SBIS-03', { resultado: 'concessao' }))).toBe('ok');
    expect(
      await s.avaliar(A, c.id, 'SBIS-05', {
        resultado: 'nao-conforme',
        severidade: 'bloqueante',
        origem: 'defeito',
        evidencia: 'sem bloqueio',
      }),
    ).toMatchObject({ correcao: 'aberta' });
    expect(await codigo(s.avaliar(A, c.id, 'XYZ-1', { resultado: 'conforme', evidencia: 'x' }))).toBe(
      'requisito-desconhecido',
    );
    const apagar = { resultado: 'conforme', evidencia: 'apagar a não conformidade' } as const;
    expect(await codigo(s.avaliar(A, c.id, 'SBIS-05', apagar))).toBe('nc-sem-verificacao');
    expect(await codigo(s.verificar(B, c.id, 'SBIS-05'))).toBe('correcao-nao-corrigida');
    await s.corrigir(A, c.id, 'SBIS-05', 'Bloqueio após 5 tentativas');
    expect(await codigo(s.avaliar(A, c.id, 'SBIS-05', apagar))).toBe('nc-sem-verificacao');
    expect(await codigo(s.corrigir(A, c.id, 'SBIS-05', 'Bloqueio após 5 tentativas'))).toBe(
      'correcao-nao-aberta',
    );
    expect(await codigo(s.verificar(A, c.id, 'SBIS-05'))).toBe('verificador-igual');
    expect(await s.verificar(B, c.id, 'SBIS-05')).toEqual({ correcao: 'verificada' });
    expect(await codigo(s.concluir(A, c.id, { parecerTexto: 'Autoavaliação de fevereiro' }))).toBe(
      'itens-pendentes',
    );
    for (const r of REQUISITOS_SBIS)
      if (!['SBIS-03', 'SBIS-05'].includes(r.codigo))
        await s.avaliar(A, c.id, r.codigo, { resultado: 'conforme', evidencia: 'roteiro' });
    const fim = await s.concluir(A, c.id, { parecerTexto: 'Autoavaliação de fevereiro' });
    expect(fim).toMatchObject({ situacao: 'concluido', parecer: 'apto' });
    expect(fim.resumo).toMatchObject({ concessao: 1, 'nao-conforme': 1, bloqueantesAbertas: 0, defeitos: 1 });
    expect(await codigo(s.abrirCiclo(A, { tipo: 'autoavaliacao', versao: '1.0.1' }))).toBe(
      'autoavaliacao-do-mes',
    );
    expect(await codigo(s.cancelar(A, c.id, 'engano'))).toBe('ciclo-fechado');
    expect(await codigo(s.ciclo(A, '999'))).toBe('nao-encontrado');
  });

  it('concluir recusa com itens-mudaram quando uma bloqueante chega entre a leitura e a gravação', async () => {
    const { porta, s } = montar();
    const c = await s.abrirCiclo(A, { tipo: 'autoavaliacao', versao: '1.0.0' });
    for (const r of REQUISITOS_SBIS)
      await s.avaliar(A, c.id, r.codigo, { resultado: 'conforme', evidencia: 'ok' });
    const gravar = porta.concluir.bind(porta);
    porta.concluir = async (h, x) => {
      // O avaliador B registra a bloqueante depois que A leu os itens (parecer calculado: apto).
      await porta.avaliar(h, {
        idCiclo: c.id,
        requisito: 'SBIS-05',
        por: 'B',
        pedido: { resultado: 'nao-conforme', severidade: 'bloqueante', origem: 'defeito', evidencia: 'x' },
      });
      return gravar(h, x);
    };
    expect(await codigo(s.concluir(A, c.id, { parecerTexto: 'apto?' }))).toBe('itens-mudaram');
    expect((await s.ciclo(A, c.id)).situacao).toBe('aberto');
  });

  it('pré-auditoria e auditoria formal: avaliador, concessão vira não conformidade e o certificado só na auditoria apta', async () => {
    const { porta, s } = montar();
    expect(await codigo(s.abrirCiclo(A, { tipo: 'pre-auditoria', versao: '1.0.0' }))).toBe(
      'avaliador-obrigatorio',
    );
    const pre = await s.abrirCiclo(A, { tipo: 'pre-auditoria', versao: '1.0.0', avaliador: 'Consultoria' });
    expect(await codigo(s.avaliar(A, pre.id, 'SBIS-03', { resultado: 'concessao' }))).toBe(
      'concessao-fora-da-autoavaliacao',
    );
    for (const r of REQUISITOS_SBIS)
      await s.avaliar(A, pre.id, r.codigo, { resultado: 'conforme', evidencia: 'ok' });
    await s.concluir(A, pre.id, { parecerTexto: 'Sem não conformidade' });
    const auditoria = { tipo: 'auditoria' as const, versao: '1.0.0', avaliador: 'Auditoria' };
    expect(await codigo(s.abrirCiclo(A, auditoria))).toBe('concessoes-vigentes');
    for (const c of CONCESSOES_COEXISTENCIA)
      await porta.encerrar('pc', { codigo: c, evidencia: 'teste', por: 'SINT.AUDITOR' });
    const aud = await s.abrirCiclo(A, auditoria);
    for (const r of REQUISITOS_SBIS)
      await s.avaliar(A, aud.id, r.codigo, { resultado: 'conforme', evidencia: 'ok' });
    expect(await codigo(s.concluir(A, aud.id, { parecerTexto: 'Certificação concedida' }))).toBe(
      'certificado-obrigatorio',
    );
    await s.concluir(A, aud.id, { parecerTexto: 'Certificação concedida', certificado: 'SBIS-0001-A' });
    const painel = await s.painel(A);
    expect(painel.certificado).toBe('SBIS-0001-A');
    expect(painel.ciclos.map((c) => c.tipo)).toEqual(['auditoria', 'pre-auditoria']);
  });

  it('cancelar o ciclo aberto', async () => {
    const { s } = montar();
    const c = await s.abrirCiclo(A, { tipo: 'autoavaliacao', versao: '1.0.0' });
    expect(await s.cancelar(A, c.id, 'aberto por engano')).toEqual({ cancelado: true });
    expect((await s.ciclo(A, c.id)).situacao).toBe('cancelado');
  });
});

describe('painel, backup e exportação', () => {
  it('pacote com o que o servidor mede; auditoria formal com o motivo', async () => {
    const { porta, s } = montar();
    porta.dias.set('2027-02-14', { dia: '2027-02-14', linhas: 3, ok: false, quebraEm: '9' });
    const p = await s.painel(A);
    const item = (k: string) => p.pacote.find((i) => i.item === k);
    expect(item('trilha-exportada')?.situacao).toBe('pendente');
    expect(item('configuracao-seguranca')?.situacao).toBe('pronto');
    expect(item('ambiente-testes')?.situacao).toBe('pronto');
    expect(item('restauracao-backup')?.situacao).toBe('pendente');
    expect(item('assinaturas')?.situacao).toBe('pronto');
    expect(p.auditoriaFormal.pode).toBe(false);
    expect(p.requisitos.total).toBe(REQUISITOS_SBIS.length);
  });

  it('restauração registrada e o backup em dia; fim no futuro recusado', async () => {
    const { s } = montar();
    const base = { resultado: 'ok' as const, integridade: 'ok' as const, ambiente: 'cópia de leitura' };
    await s.registrarRestauracao(A, {
      ...base,
      tipo: 'diaria',
      inicio: '2027-02-15T05:00:00.000Z',
      fim: '2027-02-15T05:30:00.000Z',
    });
    await s.registrarRestauracao(A, {
      ...base,
      tipo: 'mensal',
      inicio: '2027-02-01T05:00:00.000Z',
      fim: '2027-02-01T09:00:00.000Z',
    });
    const b = await s.backup(A);
    expect(b).toMatchObject({
      diaria: { emDia: true },
      mensal: { emDia: true },
      alertas: [],
      destino: 'memoria',
    });
    expect(b.restauracoes[0]?.duracaoMinutos).toBe(30);
    expect(
      await codigo(
        s.registrarRestauracao(A, {
          ...base,
          tipo: 'diaria',
          inicio: '2027-02-16T05:00:00.000Z',
          fim: '2027-02-16T06:00:00.000Z',
        }),
      ),
    ).toBe('entrada-invalida');
  });

  it('identificação que não se lê: 503, nunca o arquivo com CNES e CNPJ em branco', async () => {
    const { porta, s } = montar();
    porta.identificacao = async () => {
      throw new Error('banco fora');
    };
    expect(await codigo(s.identificacaoEProva(A, '2027-02-01', '2027-02-03'))).toBe('indisponivel');
  });

  it('identificação e prova do período; o arquivo leva as duas', async () => {
    const { s } = montar();
    const { identificacao, prova } = await s.identificacaoEProva(A, '2027-02-01', '2027-02-03');
    expect(identificacao).toMatchObject({
      software: 'Sante SGH',
      versao: '1.0.0+abcdef1',
      ambiente: 'homologacao',
      cnes: '0000000',
      geradoEm: '2027-02-15T12:00:00.000-03:00',
      geradoPor: 'SINT.AUDITOR',
    });
    expect(prova).toMatchObject({ dias: 3, integra: true });
    const linha = {
      id: '1',
      origem: 'novo' as const,
      dataHora: '2027-02-01T10:00:00.000Z',
      usuario: 'SINT.A',
      acao: '=cmd',
      opcao: null,
      criticidade: null,
      estacao: null,
      alvo: null,
      paciente: null,
      resultado: 'sucesso',
      atorReal: null,
    };
    const csv = exportarTrilhaSbis([linha as never], 'csv', identificacao, prova, {
      cortado: false,
      teto: 10,
    });
    expect(csv.split('\r\n')[0]).toBe('"# software";"Sante SGH"');
    expect(csv).toContain('"# cadeiaIntegra";"sim"');
    expect(csv).toContain('"\'=cmd"');
    const xml = exportarTrilhaSbis([linha as never], 'xml', identificacao, prova, {
      cortado: true,
      teto: 10,
    });
    expect(xml.match(/<\?xml/g)).toHaveLength(1);
    expect(xml).toContain('<identificacao software="Sante SGH"');
    expect(xml).toContain('cadeiaIntegra="sim"');
    expect(xml).toContain('<trilha cortada="true"');
  });
});

describe('medidas das concessões (falha fechada)', () => {
  it('cada medida', () => {
    const resumo = (porSenha: Record<string, number | '<5'>, tabelasProntas = true) =>
      ({ tabelasProntas, porSenha }) as unknown as ResumoIdentidade;
    expect(medidaSenha(resumo({ forte: 10, 'legado-texto-puro': 0 })).indicador).toBe('atendido');
    expect(medidaSenha(resumo({ 'legado-sem-salt': '<5' })).indicador).toBe('pendente');
    expect(medidaSenha(resumo({}, false))).toBe(INDISPONIVEL);
    const painel = (ativos: number, excedido = false) =>
      ({
        grupos: [
          { grupo: 'MASTER', ativos: 3 },
          { grupo: 'SEM GRUPO', ativos },
        ],
        administradores: { maximo: 3, ativosNoMaster: 3, mantidos: 3, excedido },
      }) as unknown as PainelSaneamento;
    expect(medidaPermissoes(painel(0)).indicador).toBe('atendido');
    expect(medidaPermissoes(painel(2)).medida).toContain('<5');
    expect(medidaPermissoes(painel(7)).medida).toContain(': 7;');
    expect(medidaPermissoes(painel(0, true)).indicador).toBe('pendente');
    const desv = (planoAplicado: boolean, excessoTotal = 0) =>
      ({ planoAplicado, excessoTotal, faltaTotal: 0, versaoPlano: 'abc' }) as DesviosPrivilegiosResposta;
    expect(medidaPrivilegio(desv(false)).indicador).toBe('pendente');
    expect(medidaPrivilegio(desv(true, 2)).medida).toContain('2 a mais');
    expect(medidaPrivilegio(desv(true)).indicador).toBe('atendido');
    expect(medidaTrilha({ desligado: true, contingenciaAtiva: true }).indicador).toBe('pendente');
    expect(medidaProntuario({ concessaoVigente: true } as ImutabilidadeResposta).indicador).toBe('pendente');
    const seg = (comValor: number | '<5') =>
      ({ tabelas: [{ rotulo: 'Convênios', comValor }] }) as unknown as SegredosLegadoResposta;
    expect(medidaSegredos(seg(0)).indicador).toBe('atendido');
    expect(medidaSegredos(seg('<5')).medida).toContain('Convênios');
  });

  it('fonte que falha vira indisponível; segundo fator dos críticos em vigor', async () => {
    const m = await medirConcessoes(
      {
        prontuario: async () => {
          throw new Error('fora');
        },
      },
      { desligado: true, contingenciaAtiva: false },
    );
    expect(m['prontuario-alteravel']).toBe(INDISPONIVEL);
    expect(m['senha-formato-antigo']).toBe(INDISPONIVEL);
    expect(m['trilha-alteravel']?.indicador).toBe('atendido');
    const pol = (p: Partial<Politica2fa>) =>
      ({ ativa: true, onda: 2, alvo: 'grupo', inicio: '2027-01-01', ...p }) as Politica2fa;
    expect(segundoFatorCriticos([pol({})], '2027-02-01')).toBe(false);
    expect(segundoFatorCriticos([pol({ onda: 1 })], '2027-02-01')).toBe(true);
    expect(segundoFatorCriticos([pol({ alvo: 'todos', inicio: '2027-03-01' })], '2027-02-01')).toBe(false);
    expect(segundoFatorCriticos([pol({ onda: 1, ativa: false })], '2027-02-01')).toBe(false);
  });
});
