import { CATALOGO_FACHADA, CONFIGURACAO_FACHADA_PADRAO, type ConfiguracaoFachada } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { filtrarPorRelevancia, normalizarChave, similaridade, sugerirAgendas } from './busca.js';
import {
  conferirDiaria,
  lerCorpoSituacao,
  prepararSituacao,
  type RetratoConvenio,
  resultadoSituacao,
} from './convenio-situacao.js';
import { lerCodigoConvenio, lerFiltroConvenios, responderConvenio, responderConvenios } from './convenios.js';
import {
  ehRecusaDeConteudo,
  ErroHttpFachada,
  inteiroNaFaixa,
  mensagemValidacao,
  respostaDeErro,
  rotaNaoEncontrada,
} from './erros.js';
import { MotorAcoesFachada, mesmoEstado } from './motor.js';
import {
  ContadorUsoFachada,
  corpoStatusAcoes,
  montarPainelFachada,
  necessidadeFachada,
  prontidaoUtf8,
} from './painel.js';
import {
  autenticar,
  casarRota,
  destinoValido,
  extrairToken,
  lerConfiguracaoFachada,
  modoDaOperacao,
  tokensAceitos,
  validarValorFachada,
} from './rotas.js';

const op = (id: string) => CATALOGO_FACHADA.find((o) => o.id === id)!;
const ligada: ConfiguracaoFachada = { ...CONFIGURACAO_FACHADA_PADRAO, ligada: true };

const capturar = (fn: () => unknown): ErroHttpFachada => {
  try {
    fn();
  } catch (e) {
    return e as ErroHttpFachada;
  }
  throw new Error('não lançou');
};

describe('casamento de rota', () => {
  it('caminho fixo, com parâmetro e inexistente', () => {
    expect(casarRota('GET', '/convenios?ativo=true')?.operacao.id).toBe('GET /convenios');
    const c = casarRota('get', '/convenios/315');
    expect(c?.operacao.id).toBe('GET /convenios/{codigo}');
    expect(c?.parametros).toEqual({ codigo: '315' });
    expect(casarRota('POST', '/exames/agendamentos/cancelar')?.operacao.id).toBe(
      'POST /exames/agendamentos/cancelar',
    );
    expect(casarRota('GET', '/auditoria/internacoes/12/evolucoes')?.parametros).toEqual({ episodio: '12' });
    expect(casarRota('GET', '/nao-existe')).toBeNull();
    expect(casarRota('DELETE', '/convenios/1')).toBeNull();
    expect(casarRota('GET', '/convenios/1/2')).toBeNull();
    expect(casarRota('GET', '/convenios/')?.operacao.id).toBe('GET /convenios');
  });
});

describe('escopo do token por superfície', () => {
  const tokens = { principal: 'p'.repeat(32), gestao: 'g'.repeat(32), auditoria: null };
  it('público, principal, próprio e o principal de quem não tem próprio', () => {
    expect(() => autenticar(op('GET /health'), null, tokens)).not.toThrow();
    expect(capturar(() => autenticar(op('GET /health/db'), null, tokens)).status).toBe(401);
    expect(() => autenticar(op('GET /health/db'), 'p'.repeat(32), tokens)).not.toThrow();
    // Gestão com token próprio: SÓ ele.
    expect(capturar(() => autenticar(op('GET /gestao/receita'), 'p'.repeat(32), tokens)).codigo).toBe(
      'nao_autorizado',
    );
    expect(() => autenticar(op('GET /gestao/receita'), 'g'.repeat(32), tokens)).not.toThrow();
    // Auditoria sem token próprio: o principal.
    expect(tokensAceitos(op('GET /auditoria/panorama'), tokens)).toEqual(['p'.repeat(32)]);
    // Sem token nenhum configurado: tudo (menos o público) recusa.
    expect(
      capturar(() =>
        autenticar(op('GET /convenios'), 'x', { principal: null, gestao: null, auditoria: null }),
      ).status,
    ).toBe(401);
  });
  it('lê Bearer e x-api-key', () => {
    expect(extrairToken('Bearer abc ', undefined)).toBe('abc');
    expect(extrairToken('bearer   xyz', 'outro')).toBe('xyz');
    expect(extrairToken(undefined, ' k ')).toBe('k');
    expect(extrairToken('Basic zzz', undefined)).toBeNull();
  });
});

describe('configuração e modo', () => {
  it('padrão desligada, escrita desligada', () => {
    const c = lerConfiguracaoFachada(new Map());
    expect(c.ligada).toBe(false);
    expect(c.escrita).toBe(false);
    expect(c.superficies).toHaveLength(5);
    expect(c.destino).toBeNull();
    const d = lerConfiguracaoFachada(
      new Map([
        ['integracao.fachada.ligada', 'sim'],
        ['integracao.fachada.superficies', 'gestao, atendimento,xyz'],
        ['integracao.fachada.destino', 'https://api.exemplo.test/'],
      ]),
    );
    expect(d).toEqual({
      ligada: true,
      escrita: false,
      superficies: ['atendimento', 'gestao'],
      destino: 'https://api.exemplo.test',
    });
  });
  it('valida os valores pedidos', () => {
    expect(validarValorFachada('integracao.fachada.ligada', 'sim')).toEqual({ valor: 'sim' });
    expect(validarValorFachada('integracao.fachada.ligada', 'talvez')).toHaveProperty('recusa');
    expect(validarValorFachada('integracao.fachada.superficies', 'acoes,xpto')).toHaveProperty('recusa');
    expect(validarValorFachada('integracao.fachada.superficies', 'gestao,saude')).toEqual({
      valor: 'gestao,saude',
    });
    expect(validarValorFachada('integracao.fachada.destino', 'https://u:s@h.test')).toHaveProperty('recusa');
    expect(validarValorFachada('integracao.fachada.destino', 'ftp://h.test')).toHaveProperty('recusa');
    expect(validarValorFachada('integracao.fachada.destino', '')).toEqual({ valor: '' });
    expect(destinoValido('http://10.0.0.1:3000/')).toBe('http://10.0.0.1:3000');
    expect(validarValorFachada('legado.charset', 'UTF8')).toHaveProperty('recusa');
  });
  it('servida, repassada, desligada (com o motivo)', () => {
    const verde = () => 'verde';
    expect(modoDaOperacao(op('GET /convenios'), CONFIGURACAO_FACHADA_PADRAO, verde).modo).toBe('desligada');
    expect(modoDaOperacao(op('GET /convenios'), ligada, verde)).toEqual({
      modo: 'servida',
      motivo: null,
      causa: null,
    });
    expect(modoDaOperacao(op('GET /medicos'), ligada, verde).modo).toBe('desligada');
    expect(modoDaOperacao(op('GET /medicos'), { ...ligada, destino: 'http://h' }, verde).modo).toBe(
      'repassada',
    );
    expect(
      modoDaOperacao(op('GET /gestao/receita'), { ...ligada, superficies: ['atendimento'] }, verde).motivo,
    ).toContain('gestao');
    // Escrita servida com a operação equivalente não provada: desligada (POL-3), com o nome dela.
    const escrita = { ...ligada, escrita: true };
    const m = modoDaOperacao(op('POST /acoes/convenios/situacao'), escrita, () => 'especificada');
    expect(m).toMatchObject({ modo: 'desligada', causa: 'nao-provada' });
    expect(m.motivo).toContain('convenio.alterarSituacao');
    expect(modoDaOperacao(op('POST /acoes/convenios/situacao'), escrita, verde).modo).toBe('servida');
    // Escrita desligada (padrão): toda escrita, servida ou repassada, fica desligada.
    expect(modoDaOperacao(op('POST /acoes/convenios/situacao'), ligada, verde).causa).toBe('escrita');
    expect(
      modoDaOperacao(op('POST /consultas/agendamentos'), { ...ligada, destino: 'http://h' }, verde).causa,
    ).toBe('escrita');
    expect(
      modoDaOperacao(op('POST /consultas/agendamentos'), { ...escrita, destino: 'http://h' }, verde).modo,
    ).toBe('repassada');
  });
});

describe('contrato de erro', () => {
  it('negócio com código; 5xx genérico; nunca a mensagem do banco', () => {
    const r = respostaDeErro(new ErroHttpFachada(409, 'x', 'acao_sem_efeito', { motivo: 'm' }));
    expect(r).toEqual({
      status: 409,
      corpo: { status: 'error', codigo: 'acao_sem_efeito', message: 'x', motivo: 'm' },
      interno: false,
    });
    const b = respostaDeErro(new Error('Dynamic SQL Error, SQL error code = -303'));
    expect(b.status).toBe(500);
    expect(b.corpo.codigo).toBe('erro_interno');
    expect(JSON.stringify(b.corpo)).not.toContain('SQL');
    expect(respostaDeErro(new ErroHttpFachada(503, 'fora', 'destino_indisponivel')).corpo.codigo).toBe(
      'destino_indisponivel',
    );
    expect(rotaNaoEncontrada('GET', '/xyz?a=1').message).toContain('GET /xyz não existe');
  });
  it('mensagens de validação em português', () => {
    expect(mensagemValidacao('querystring', [{ tipo: 'maximum', campo: 'limite', limite: 500 }])).toBe(
      'Requisição inválida: O parâmetro "limite" deve ser no máximo 500.',
    );
    expect(mensagemValidacao('body', [{ tipo: 'required', campo: 'convenio' }])).toBe(
      'Requisição inválida: Falta o campo do corpo obrigatório "convenio".',
    );
    expect(capturar(() => inteiroNaFaixa(40000, 'codigo', -32768, 32767)).codigo).toBe('valor_fora_da_faixa');
    expect(ehRecusaDeConteudo({ gdscode: 335544558 })).toBe(true);
    expect(ehRecusaDeConteudo({ gdscode: 1 })).toBe(false);
  });
});

describe('motor de dois tempos', () => {
  const preparada = (estado: unknown, aplicar: () => void) => ({
    params: { cod: 1 },
    estadoAntes: estado,
    corpo: { efeito: 'x' },
    executar: async () => {
      aplicar();
      return { feito: true };
    },
  });

  it('proposta não escreve; confirmar aplica uma vez só', async () => {
    let t = 1_000;
    let escritas = 0;
    const m = new MotorAcoesFachada({ agora: () => t, novoId: () => 'prop_1' });
    const p = m.propor(
      'convenios/situacao',
      preparada({ s: 'A' }, () => escritas++),
      async () => ({ s: 'A' }),
    );
    expect(escritas).toBe(0);
    expect(p).toMatchObject({ propostaId: 'prop_1', aplicada: false, validadeMinutos: 15, efeito: 'x' });
    expect(m.pendentes()).toBe(1);
    const r = await m.confirmar('prop_1');
    expect(r).toMatchObject({ propostaId: 'prop_1', aplicada: true, feito: true });
    expect(escritas).toBe(1);
    await expect(m.confirmar('prop_1')).rejects.toMatchObject({
      status: 404,
      codigo: 'proposta_nao_encontrada',
    });
    t += 1;
  });

  it('expira em 15 minutos', async () => {
    let t = 0;
    const m = new MotorAcoesFachada({ agora: () => t, novoId: () => 'prop_2' });
    m.propor(
      'a',
      preparada(1, () => undefined),
      async () => 1,
    );
    t = 15 * 60 * 1000;
    expect(m.conhece('prop_2')).toBe(false);
    await expect(m.confirmar('prop_2')).rejects.toMatchObject({ status: 404 });
  });

  it('estado mudado: 409 sem executar e a proposta descartada', async () => {
    let escritas = 0;
    const m = new MotorAcoesFachada({ novoId: () => 'prop_3' });
    m.propor(
      'a',
      preparada({ s: 'A' }, () => escritas++),
      async () => ({ s: 'I' }),
    );
    await expect(m.confirmar('prop_3')).rejects.toMatchObject({
      status: 409,
      codigo: 'proposta_desatualizada',
      extra: { estadoNaProposta: { s: 'A' }, estadoAgora: { s: 'I' } },
    });
    expect(escritas).toBe(0);
    expect(m.pendentes()).toBe(0);
  });

  it('teto de propostas e fila por ação e parâmetros', async () => {
    let n = 0;
    const m = new MotorAcoesFachada({ maxPropostas: 2, novoId: () => `prop_${++n}` });
    const ordem: string[] = [];
    const lenta = (nome: string, ms: number) => ({
      params: { cod: 7 },
      estadoAntes: 0,
      corpo: {},
      executar: async () => {
        ordem.push(`ini-${nome}`);
        await new Promise((r) => setTimeout(r, ms));
        ordem.push(`fim-${nome}`);
        return {};
      },
    });
    m.propor('a', lenta('1', 20), async () => 0);
    m.propor('a', lenta('2', 1), async () => 0);
    expect(capturar(() => m.propor('a', lenta('3', 1), async () => 0)).status).toBe(429);
    await Promise.all([m.confirmar('prop_1'), m.confirmar('prop_2')]);
    expect(ordem).toEqual(['ini-1', 'fim-1', 'ini-2', 'fim-2']);
  });

  it('a proposta fica presa ao escopo em que nasceu (rede:estabelecimento)', async () => {
    let escritas = 0;
    const m = new MotorAcoesFachada({ novoId: () => 'prop_e' });
    m.propor(
      'a',
      preparada({ s: 'A' }, () => escritas++),
      async () => ({ s: 'A' }),
      'r:aa',
    );
    expect(m.conhece('prop_e', 'r:bb')).toBe(false);
    expect(m.conhece('prop_e')).toBe(false);
    expect(m.pendentes('r:bb')).toBe(0);
    expect(m.pendentes('r:aa')).toBe(1);
    await expect(m.confirmar('prop_e', 'r:bb')).rejects.toMatchObject({
      status: 404,
      codigo: 'proposta_nao_encontrada',
    });
    expect(escritas).toBe(0);
    await expect(m.confirmar('prop_e', 'r:aa')).resolves.toMatchObject({ aplicada: true });
    expect(escritas).toBe(1);
  });

  it('igualdade estável independe da ordem das chaves', () => {
    expect(mesmoEstado({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })).toBe(true);
    expect(mesmoEstado({ a: 1 }, { a: 2 })).toBe(false);
  });
});

describe('busca por relevância (a mesma da API original)', () => {
  const nomes = ['BRADESCO SAUDE', 'SUL AMERICA', 'AMIL', 'UNIMED', 'GOLDEN CROSS', 'CASSI'];
  it('normaliza, casa por palavra, colado e prefixo', () => {
    expect(normalizarChave('Sul-América  Saúde')).toBe('SUL AMERICA SAUDE');
    expect(similaridade('AMIL', 'amil')).toBe(1);
    expect(filtrarPorRelevancia(nomes, 'sulamerica', (x) => x)).toEqual(['SUL AMERICA']);
    expect(filtrarPorRelevancia(nomes, 'Bradesco Nacional Flex', (x) => x)).toEqual(['BRADESCO SAUDE']);
    expect(filtrarPorRelevancia(nomes, 'unim', (x) => x)).toEqual(['UNIMED']);
    expect(filtrarPorRelevancia(nomes, '', (x) => x, { limite: 2 })).toEqual([
      'BRADESCO SAUDE',
      'SUL AMERICA',
    ]);
    expect(filtrarPorRelevancia(nomes, 'xyz', (x) => x)).toEqual([]);
    expect(sugerirAgendas('UNIMEDE', nomes)).toEqual(['UNIMED']);
    expect(sugerirAgendas('', nomes)).toEqual([]);
  });
});

describe('convênios servidos', () => {
  const linhas = [
    { cod: 10, nome: 'PARTICULAR', situacao: 'A', permiteAtend: 1 },
    { cod: 315, nome: 'GOLDEN CROSS', situacao: 'I', permiteAtend: 0 },
    { cod: 20, nome: 'UNIMED', situacao: 'A', permiteAtend: 1 },
  ];
  it('lista, filtro ativo, busca com sugestões e o limite', () => {
    expect(responderConvenios(linhas, lerFiltroConvenios({}))).toEqual({
      total: 3,
      convenios: [
        { codigo: 10, nome: 'PARTICULAR', ativo: true, permiteAtendimento: 1 },
        { codigo: 315, nome: 'GOLDEN CROSS', ativo: false, permiteAtendimento: 0 },
        { codigo: 20, nome: 'UNIMED', ativo: true, permiteAtendimento: 1 },
      ],
    });
    expect(responderConvenios(linhas, lerFiltroConvenios({ ativo: 'true' })).total).toBe(2);
    expect(responderConvenios(linhas, lerFiltroConvenios({ limite: '1' })).total).toBe(1);
    const vazia = responderConvenios(linhas, lerFiltroConvenios({ busca: 'GOLDAN CRUSS' }));
    expect(vazia).toEqual({ total: 0, convenios: [], sugestoes: ['GOLDEN CROSS'] });
    expect(responderConvenios(linhas, lerFiltroConvenios({ busca: 'unimed' }))).toMatchObject({
      total: 1,
      sugestoes: [],
    });
  });
  it('validação da querystring e do código', () => {
    expect(capturar(() => lerFiltroConvenios({ limite: '0' })).message).toContain('no mínimo 1');
    expect(capturar(() => lerFiltroConvenios({ limite: '501' })).message).toContain('no máximo 500');
    expect(capturar(() => lerFiltroConvenios({ limite: 'x' })).message).toContain('do tipo integer');
    expect(capturar(() => lerFiltroConvenios({ ativo: 'sim' })).message).toContain('do tipo boolean');
    expect(capturar(() => lerFiltroConvenios({ busca: 'x'.repeat(121) })).message).toContain('no máximo 120');
    expect(lerCodigoConvenio('315')).toBe(315);
    expect(capturar(() => lerCodigoConvenio('abc')).codigo).toBe('parametro_invalido');
    expect(capturar(() => lerCodigoConvenio('99999')).codigo).toBe('valor_fora_da_faixa');
    expect(capturar(() => responderConvenio(null))).toMatchObject({
      status: 404,
      codigo: 'convenio_nao_encontrado',
    });
  });
});

describe('ação de situação do convênio', () => {
  const retrato = (situacao: string | null): RetratoConvenio => ({
    existe: true,
    cod: 315,
    situacao,
    nome: 'GOLDEN CROSS',
    permiteAtend: 1,
    classifC: 1,
    thm: 1,
    thmE: 1,
    idDth: null,
    agendasConsulta: 4,
    agendasExame: 2,
  });
  const impacto = { consulta: 3, exame: 1, contasAbertas: 2, carteira: 9, profissionais: 0 };

  it('corpo validado como a API original', () => {
    expect(lerCorpoSituacao({ convenio: 315, operacao: 'suspender' })).toEqual({
      cod: 315,
      operacao: 'suspender',
    });
    expect(capturar(() => lerCorpoSituacao({ operacao: 'suspender' })).message).toContain('"convenio"');
    expect(capturar(() => lerCorpoSituacao({ convenio: 1, operacao: 'apagar' })).message).toContain(
      'aceita apenas: suspender, reativar',
    );
    expect(capturar(() => lerCorpoSituacao({ convenio: 1.5, operacao: 'reativar' })).message).toContain(
      'integer',
    );
  });

  it('proposta com efeito, impacto, reversão e alertas; recusas do primeiro tempo', () => {
    const p = prepararSituacao({ cod: 315, operacao: 'suspender' }, retrato('A'), null, impacto);
    expect(p.corpo.convenio).toEqual({
      codigo: 315,
      nome: 'GOLDEN CROSS',
      situacaoAtual: 'A',
      situacaoDepois: 'I',
    });
    expect(p.corpo.efeito).toMatchObject({
      tabela: 'fonte_pagadora_estabelecimento',
      coluna: 'situacao',
      antes: 'ativa',
      depois: 'suspensa',
    });
    expect(p.corpo.impacto.agendamentosFuturosConsulta).toBe(3);
    expect(p.corpo.reversao.corpo).toEqual({ convenio: 315, operacao: 'reativar' });
    expect(p.corpo.alertas.length).toBe(5);
    expect(JSON.stringify(p.corpo)).not.toMatch(/SPDATA|legado/i);
    expect(
      capturar(() => prepararSituacao({ cod: 315, operacao: 'suspender' }, retrato('I'), null, impacto)),
    ).toMatchObject({ status: 409, extra: { motivo: 'ja_esta_no_estado_pedido' } });
    expect(
      capturar(() => prepararSituacao({ cod: 315, operacao: 'reativar' }, retrato('X'), null, impacto)),
    ).toMatchObject({ status: 409, extra: { motivo: 'situacao_desconhecida' } });
    expect(
      capturar(() =>
        prepararSituacao({ cod: 9, operacao: 'reativar' }, { existe: false, cod: 9 }, null, impacto),
      ).codigo,
    ).toBe('convenio_nao_encontrado');
    expect(capturar(() => conferirDiaria(315, 'X', { tipo: 2, subtipo: 1 }))).toMatchObject({
      extra: { motivo: 'bloqueado_pelo_gatilho_dth' },
    });
    expect(() => conferirDiaria(315, 'X', { tipo: 1, subtipo: 5 })).not.toThrow();
  });

  it('resultado só com a prova (situação relida = alvo)', () => {
    const base = { cod: 315, operacao: 'reativar' as const, nome: 'G', origem: 'I', reversao: {} };
    expect(resultadoSituacao(base, 'A')).toMatchObject({
      situacaoAnterior: 'I',
      situacaoAtual: 'A',
      efeito: { tabela: 'fonte_pagadora_estabelecimento', coluna: 'situacao', antes: 'suspensa', depois: 'ativa' },
    });
    expect(capturar(() => resultadoSituacao(base, 'I'))).toMatchObject({
      extra: { motivo: 'update_sem_efeito' },
    });
  });
});

describe('painel, necessidade e prontidão', () => {
  it('necessidade pela DP-8', () => {
    expect(necessidadeFachada('CP1252', false).situacao).toBe('nao-necessaria');
    expect(necessidadeFachada('CP1252', true).situacao).toBe('necessaria');
    expect(necessidadeFachada('UTF8', false).situacao).toBe('necessaria');
  });
  it('prontidão: sem uso, uso não servido e tudo servido', () => {
    const servidas = new Set(['GET /convenios']);
    expect(prontidaoUtf8([], servidas).pronta).toBe(false);
    expect(prontidaoUtf8(['GET /medicos', 'GET /convenios'], servidas).usadasNaoServidas).toEqual([
      'GET /medicos',
    ]);
    expect(prontidaoUtf8(['GET /convenios'], servidas).pronta).toBe(true);
  });
  it('monta o painel com totais, superfícies e uso (sem expor token)', () => {
    const uso = new ContadorUsoFachada(new Date('2026-10-28T12:00:00Z'));
    uso.registrar('GET /convenios', false);
    uso.registrar('GET /convenios', true);
    const p = montarPainelFachada({
      hospital: 'pc',
      configuracao: { ...ligada, destino: 'http://h' },
      tokens: { principal: 'segredo-principal', gestao: null, auditoria: null },
      estado: () => 'verde',
      uso,
      pendentes: 0,
      charset: 'CP1252',
      ensaioUtf8Concluido: true,
      podeConfigurar: false,
    });
    // Escrita desligada (padrão): as 23 escritas ficam desligadas (2 servidas entre elas).
    expect(p.totais).toEqual({ operacoes: 78, servidas: 5, repassadas: 50, desligadas: 23 });
    expect(p.operacoes.find((o) => o.id === 'GET /convenios')).toMatchObject({ chamadas: 2, erros: 1 });
    expect(p.superficies.find((s) => s.superficie === 'gestao')).toMatchObject({ tokenConfigurado: true });
    expect(JSON.stringify(p)).not.toContain('segredo-principal');
    expect(p.prontidaoUtf8.pronta).toBe(true);
    expect(p.necessidade.situacao).toBe('necessaria');
  });
  it('status das ações: forma da API original e quem atende', () => {
    const s = corpoStatusAcoes(false, 0, (r) => r === '/acoes/convenios/situacao');
    expect(s.habilitada).toBe(false);
    expect(s.acoesDisponiveis).toHaveLength(11);
    expect(s.acoesDisponiveis.find((a) => a.acao === 'convenios/situacao')?.atendidaPor).toBe('sante');
    expect(s.acoesDisponiveis.find((a) => a.acao === 'agenda/grade')?.atendidaPor).toBe('repasse');
  });
});
