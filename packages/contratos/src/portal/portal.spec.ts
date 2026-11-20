// Contratos do portal do paciente (M50 etapa 1): vocabulário, entradas, respostas, permissões no catálogo, eventos de
// auditoria, chave de liberação e parâmetros. Dados sintéticos.
import { describe, expect, it } from 'vitest';
import { CATALOGO_EVENTOS, EVENTOS_AUDITAVEIS } from '../auditoria/eventos.js';
import { RECURSOS_DESLIGADOS } from '../liberacao/recursos.js';
import { definicaoParametro } from '../parametros/definicoes.js';
import { PARAMETROS_PORTAL } from '../parametros/portal.js';
import { CATALOGO_DECLARADO } from '../permissoes/catalogo.js';
import { PERMISSOES_CODIGOS_PORTAL, PERMISSOES_PORTAL_M50 } from '../permissoes/portal.js';
import { FORMATO_CODIGO_PERMISSAO } from '../permissoes/tipos.js';
import {
  esquemaAbrirItemPortal,
  esquemaAtivarContaPortal,
  esquemaBloquearContaPortal,
  esquemaConferirConvite,
  esquemaConfirmarSegundoFator,
  esquemaConsentimentoPortal,
  esquemaConvidarContaPortal,
  esquemaDecidirVinculo,
  esquemaDesbloquearContaPortal,
  esquemaEncerrarContaPortal,
  esquemaEncerrarVinculo,
  esquemaEntrarContaPortal,
  esquemaEscolherTitular,
  esquemaFiltroAcessosTitular,
  esquemaPedidoTitularPortal,
  esquemaPedirVinculo,
  esquemaRevogarVinculoPeloTitular,
  esquemaTrocarSenhaPortal,
} from './entradas.js';
import {
  esquemaAtivacaoIniciada,
  esquemaConsentimentoPortalItem,
  esquemaConviteEmitido,
  esquemaRelatorioAcessosTitular,
  esquemaSessaoContaPortal,
  esquemaVinculoParaConferir,
} from './respostas.js';
import {
  CANAIS_PEDIDO_COM_PORTAL,
  CHAVE_PORTAL_CONTA,
  ESCOPO_PADRAO_VINCULO,
  FINALIDADES_CONSENTIMENTO_PORTAL,
  NATUREZA_DO_EVENTO,
  PROVAS_ACEITAS,
  PROVAS_VINCULO,
  TIPOS_DOCUMENTO_PORTAL,
  TIPOS_VINCULO_RESPONSAVEL,
} from './vocabulario.js';

const SEM_OUTRO_SISTEMA = /spdata|legado|sistema atual|sistema antigo/i;

describe('vocabulário', () => {
  it('o portal não muda o consentimento para o atendimento (base legal da tutela da saúde)', () => {
    expect(FINALIDADES_CONSENTIMENTO_PORTAL).toEqual(['comunicacao', 'pesquisa', 'compartilhamento-rede']);
  });
  it('toda prova aceita existe e todo vínculo tem prova e escopo padrão', () => {
    for (const t of TIPOS_VINCULO_RESPONSAVEL) {
      expect(PROVAS_ACEITAS[t].length).toBeGreaterThan(0);
      for (const p of PROVAS_ACEITAS[t]) expect(PROVAS_VINCULO).toContain(p);
      expect(ESCOPO_PADRAO_VINCULO[t]).toBeDefined();
    }
    expect(ESCOPO_PADRAO_VINCULO.procurador).toEqual([]);
  });
  it('documentos do portal nunca incluem registro clínico, alergia nem anexo', () => {
    for (const t of ['registro-clinico', 'alergia', 'anexo', 'exame-externo', 'declaracao-obito'])
      expect(TIPOS_DOCUMENTO_PORTAL as readonly string[]).not.toContain(t);
  });
  it('o canal "portal" se soma aos canais do pedido do titular', () => {
    expect(CANAIS_PEDIDO_COM_PORTAL).toContain('portal');
    expect(CANAIS_PEDIDO_COM_PORTAL).toContain('presencial');
  });
  it('o mapa de eventos do relatório de acessos só traz leituras', () => {
    expect(NATUREZA_DO_EVENTO['pep.prontuario.lido']).toBe('consulta-ao-prontuario');
    expect(NATUREZA_DO_EVENTO['acesso.emergencia.aberta']).toBe('acesso-de-emergencia');
    expect(NATUREZA_DO_EVENTO['auditoria.leitura.alertada']).toBeUndefined();
  });
});

describe('entradas das telas internas', () => {
  it('convite pelo ID do paciente e pela origem; nada além', () => {
    expect(esquemaConvidarContaPortal.parse({ idPaciente: 10, origem: 'recepcao' })).toEqual({
      idPaciente: 10,
      origem: 'recepcao',
    });
    expect(
      esquemaConvidarContaPortal.safeParse({ idPaciente: 10, origem: 'recepcao', email: 'x' }).success,
    ).toBe(false);
    expect(esquemaConvidarContaPortal.safeParse({ idPaciente: 0, origem: 'recepcao' }).success).toBe(false);
  });
  it('bloquear, desbloquear e encerrar exigem justificativa', () => {
    expect(
      esquemaBloquearContaPortal.safeParse({ conta: '7', motivo: 'tentativas', justificativa: 'curta' })
        .success,
    ).toBe(false);
    expect(
      esquemaBloquearContaPortal.parse({
        conta: '7',
        motivo: 'suspeita-de-fraude',
        justificativa: 'Tentativas de outro estado',
      }).motivo,
    ).toBe('suspeita-de-fraude');
    expect(
      esquemaDesbloquearContaPortal.parse({ conta: '7', justificativa: 'Paciente trocou de aparelho' })
        .refazerSegundoFator,
    ).toBe(false);
    expect(
      esquemaEncerrarContaPortal.safeParse({ conta: '0', motivo: 'obito', justificativa: 'Óbito registrado' })
        .success,
    ).toBe(false);
  });
  it('decidir vínculo: aprovar com escopo e validade; recusar com motivo', () => {
    const a = esquemaDecidirVinculo.parse({ decisao: 'aprovar', vinculo: '3', escopos: ['documentos'] });
    expect(a).toEqual({ decisao: 'aprovar', vinculo: '3', escopos: ['documentos'], validade: null });
    expect(
      esquemaDecidirVinculo.safeParse({ decisao: 'recusar', vinculo: '3', motivo: 'ilegível' }).success,
    ).toBe(false);
    expect(
      esquemaDecidirVinculo.safeParse({
        decisao: 'aprovar',
        vinculo: '3',
        escopos: [],
        validade: '2026-02-30x',
      }).success,
    ).toBe(false);
    expect(
      esquemaEncerrarVinculo.parse({
        vinculo: '3',
        motivo: 'decisao-judicial',
        justificativa: 'Ofício recebido pela privacidade',
      }).motivo,
    ).toBe('decisao-judicial');
  });
});

describe('entradas do portal', () => {
  it('o código do convite aceita hífens e minúsculas, e recusa 0, O, 1 e I', () => {
    expect(esquemaConferirConvite.parse({ codigo: 'abcd-efgh-jkmn', nascimento: '2000-01-31' }).codigo).toBe(
      'ABCDEFGHJKMN',
    );
    expect(
      esquemaConferirConvite.safeParse({ codigo: 'ABCD-EFGH-JK0N', nascimento: '2000-01-31' }).success,
    ).toBe(false);
    expect(
      esquemaConferirConvite.safeParse({ codigo: 'ABCD-EFGH-JKMN', nascimento: '2000-13-01' }).success,
    ).toBe(false);
  });
  it('ativar: e-mail normalizado, confirmação igual, termos com versão', () => {
    const base = {
      codigo: 'ABCDEFGHJKMN',
      nascimento: '1990-05-05',
      email: '  Fulano@Exemplo.TEST ',
      senha: 'uma frase longa 42',
      confirmacao: 'uma frase longa 42',
      termoUso: 'v1',
      politicaPrivacidade: 'v1',
    };
    expect(esquemaAtivarContaPortal.parse(base).email).toBe('fulano@exemplo.test');
    expect(esquemaAtivarContaPortal.safeParse({ ...base, confirmacao: 'outra' }).success).toBe(false);
    expect(esquemaAtivarContaPortal.safeParse({ ...base, email: 'sem-arroba' }).success).toBe(false);
    expect(esquemaAtivarContaPortal.safeParse({ ...base, termoUso: '' }).success).toBe(false);
  });
  it('segundo fator e entrada: código de 6 dígitos', () => {
    expect(esquemaConfirmarSegundoFator.safeParse({ codigo: '12345' }).success).toBe(false);
    expect(esquemaConfirmarSegundoFator.parse({ codigo: '123456' })).toEqual({ codigo: '123456' });
    expect(
      esquemaEntrarContaPortal.safeParse({ email: 'a@b.test', senha: 'x', codigo: '12a456' }).success,
    ).toBe(false);
    expect(
      esquemaTrocarSenhaPortal.safeParse({ atual: 'a', nova: 'b', confirmacao: 'c', codigo: '123456' })
        .success,
    ).toBe(false);
    expect(
      esquemaTrocarSenhaPortal.safeParse({ atual: 'a', nova: 'b', confirmacao: 'b', codigo: '123456' })
        .success,
    ).toBe(true);
  });
  it('escolher titular: o próprio (null) ou um vínculo; nunca o ID do paciente', () => {
    expect(esquemaEscolherTitular.parse({ vinculo: null })).toEqual({ vinculo: null });
    expect(esquemaEscolherTitular.safeParse({ vinculo: null, idPaciente: 1 }).success).toBe(false);
  });
  it('pedir vínculo: prontuário, nascimento, tipo, prova e a chave do arquivo', () => {
    const v = esquemaPedirVinculo.parse({
      prontuario: 123,
      nascimento: '2015-03-03',
      tipo: 'pai-mae',
      prova: 'certidao-nascimento',
      arquivo: 'portal/provas/abc123456',
    });
    expect(v.validade).toBeNull();
    expect(esquemaPedirVinculo.safeParse({ ...v, arquivo: '../../etc/passwd' }).success).toBe(false);
    expect(esquemaRevogarVinculoPeloTitular.parse({ vinculo: '9' })).toEqual({ vinculo: '9' });
  });
  it('consentimento: consentir, não consentir e revogar; atendimento recusado', () => {
    expect(
      esquemaConsentimentoPortal.parse({ acao: 'consentir', finalidade: 'pesquisa', versao: '2026.1' }).acao,
    ).toBe('consentir');
    expect(
      esquemaConsentimentoPortal.safeParse({ acao: 'consentir', finalidade: 'atendimento', versao: '1' })
        .success,
    ).toBe(false);
    expect(esquemaConsentimentoPortal.parse({ acao: 'revogar', consentimento: 5 })).toEqual({
      acao: 'revogar',
      consentimento: 5,
    });
    expect(
      esquemaConsentimentoPortal.safeParse({ acao: 'nao-consentir', finalidade: 'comunicacao', versao: '1' })
        .success,
    ).toBe(true);
  });
  it('pedido do titular: tipo da LGPD e descrição opcional', () => {
    expect(esquemaPedidoTitularPortal.parse({ tipo: 'portabilidade' })).toEqual({
      tipo: 'portabilidade',
      descricao: null,
    });
    expect(esquemaPedidoTitularPortal.safeParse({ tipo: 'apagar-tudo' }).success).toBe(false);
  });
  it('relatório de acessos: período em ordem; abrir item', () => {
    expect(esquemaFiltroAcessosTitular.parse({ de: '2026-01-01', ate: '2026-01-31' }).pagina).toBe(1);
    expect(esquemaFiltroAcessosTitular.safeParse({ de: '2026-02-01', ate: '2026-01-31' }).success).toBe(
      false,
    );
    expect(esquemaAbrirItemPortal.parse({ origem: 'resultado', item: '77' }).baixar).toBe(false);
    expect(esquemaAbrirItemPortal.safeParse({ origem: 'evolucao', item: '77' }).success).toBe(false);
  });
});

describe('respostas', () => {
  it('convite emitido em grupos de 4; ativação com otpauth', () => {
    expect(
      esquemaConviteEmitido.safeParse({
        conta: '1',
        codigo: 'ABCD-EFGH-JKMN',
        validoAte: '2026-10-27T00:00:00Z',
        destino: 'memoria',
      }).success,
    ).toBe(true);
    expect(esquemaAtivacaoIniciada.safeParse({ metodo: 'totp', otpauth: 'https://x' }).success).toBe(false);
  });
  it('sessão com o titular ativo e os representados', () => {
    const t = { vinculo: null, primeiroNome: 'Ana', idade: 40, escopos: [] };
    expect(
      esquemaSessaoContaPortal.safeParse({
        hospital: 'pc',
        primeiroNome: 'Ana',
        ativo: t,
        titulares: [t, { vinculo: '2', primeiroNome: 'Bia', idade: 8, escopos: ['documentos'] }],
        expiraEm: '2026-10-24T12:00:00Z',
        soResponsavel: false,
      }).success,
    ).toBe(true);
  });
  it('fila de vínculos e consentimentos', () => {
    expect(
      esquemaVinculoParaConferir.safeParse({
        vinculo: '2',
        tipo: 'curador',
        prova: 'termo-curatela',
        situacao: 'pendente',
        escopos: [],
        pedidoEm: '2026-10-24T10:00:00Z',
        decididoEm: null,
        validade: null,
        terminaEm: null,
        motivoFim: null,
        primeiroNomeOutro: 'Caio',
        prontuarioTitular: 99,
        idadeTitular: 70,
        responsavelConta: '5',
        primeiroNomeResponsavel: 'Ana',
        diasNaFila: 0,
        canal: 'portal',
        temArquivo: true,
        guardiao: null,
        curatelado: true,
        motivoRecusa: null,
      }).success,
    ).toBe(true);
    expect(
      esquemaConsentimentoPortalItem.safeParse({
        consentimento: 1,
        finalidade: 'atendimento',
        versao: '1',
        consentiu: true,
        registradoEm: '2026-10-24T10:00:00Z',
        signatario: 'paciente',
        revogadoEm: null,
        editavel: false,
      }).success,
    ).toBe(true);
    expect(
      esquemaRelatorioAcessosTitular.safeParse({ itens: [], de: 'a', ate: 'b', haMais: false }).success,
    ).toBe(true);
  });
});

describe('permissões, eventos, liberação e parâmetros', () => {
  it('as permissões do portal estão no catálogo, no formato, sem repetição e com fonte', () => {
    const codigos = CATALOGO_DECLARADO.map((p) => p.codigo);
    for (const p of PERMISSOES_PORTAL_M50) {
      expect(FORMATO_CODIGO_PERMISSAO.test(p.codigo)).toBe(true);
      expect(codigos.filter((c) => c === p.codigo)).toHaveLength(1);
      expect(
        p.opcoesLegado.length > 0 || (p.concessaoPorPerfil === 'por-perfil' && p.perfis!.length > 0),
      ).toBe(true);
      expect(p.descricao).not.toMatch(SEM_OUTRO_SISTEMA);
    }
    expect(Object.values(PERMISSOES_CODIGOS_PORTAL).sort()).toEqual(
      PERMISSOES_PORTAL_M50.map((p) => p.codigo).sort(),
    );
  });
  it('as do portal só vão a perfil de portal; as internas nunca a perfil de portal', () => {
    for (const p of PERMISSOES_PORTAL_M50) {
      if (p.concessaoPorPerfil === 'por-perfil') {
        expect(p.opcoesLegado).toEqual([]);
        for (const perfil of p.perfis!) expect(perfil.startsWith('portal-')).toBe(true);
      } else expect(p.opcoesLegado.length).toBeGreaterThan(0);
    }
    const criticas = PERMISSOES_PORTAL_M50.filter((p) => p.criticidade === 'critica').map((p) => p.codigo);
    expect(criticas).toEqual([
      'portal.conta.bloquear',
      'portal.conta.trocarEmail',
      'portal.conta.encerrar',
      'portal.vinculo.conferir',
      'portal.copia.conferir',
    ]);
  });
  it('eventos da regra 13 (PORTAL_LOGIN, PORTAL_DOCUMENTO_VISTO) só na trilha própria', () => {
    expect(EVENTOS_AUDITAVEIS.portalLogin.codigo).toBe('portal.conta.entrou');
    expect(EVENTOS_AUDITAVEIS.portalDocumentoVisto.codigo).toBe('portal.documento.visto');
    // Os do portal do paciente (os `portal.medico.*` são do portal do médico externo, etapa 3): 12 da etapa 1 e 6 da
    // etapa 2 (agendamento, pré-check-in enviado e conferido, pagamento iniciado e confirmado, pesquisa) e 3 do W0-10
    // (troca do e-mail pedida ou cancelada, e-mail trocado, pedido do titular cancelado) e 2 da tesouraria do W0-10
    // (pagamento conciliado e estornado) e 1 da cópia do prontuário (M2) e 1 da portabilidade em FHIR/IPS (M3).
    const doPortal = CATALOGO_EVENTOS.filter(
      (e) => e.codigo.startsWith('portal.') && !e.codigo.startsWith('portal.medico.'),
    );
    expect(doPortal.length).toBe(25);
    for (const e of doPortal) expect(e.legado).toBeNull();
    const todos = CATALOGO_EVENTOS.map((e) => e.codigo);
    expect(new Set(todos).size).toBe(todos.length);
    expect(NATUREZA_DO_EVENTO['portal.documento.visto']).toBe('portal');
  });
  it('a chave portal.conta existe, é do M50 e tem um pré-requisito por tipo', () => {
    const r = RECURSOS_DESLIGADOS.find((x) => x.chave === CHAVE_PORTAL_CONTA)!;
    expect(r.marco).toBe('M50');
    const tipos = r.prerequisitos.map((p) => p.tipo);
    expect(new Set(tipos).size).toBe(tipos.length);
    expect(`${r.titulo} ${r.descricao}`).not.toMatch(SEM_OUTRO_SISTEMA);
  });
  it('parâmetros: padrão dentro da faixa e registrados', () => {
    for (const p of PARAMETROS_PORTAL) {
      expect(definicaoParametro(p.chave)).toBe(p);
      if (p.tipo === 'inteiro') {
        const v = Number(p.padrao);
        expect(v).toBeGreaterThanOrEqual(p.minimo!);
        expect(v).toBeLessThanOrEqual(p.maximo!);
      } else expect(p.opcoes).toContain(p.padrao);
    }
    expect(definicaoParametro('portal.idadeContaPropria')!.padrao).toBe('18');
  });
});
