import { describe, expect, it } from 'vitest';
import {
  acessoBloqueado,
  acoesDoProtocolo,
  classeDaNatureza,
  conferirFuncoesPortal,
  conferirOrigemDaReanalise,
  conferirProrrogacao,
  conferirRegistroProtocolo,
  conferirResposta,
  depoisDaTentativaPortal,
  escritaPendente,
  escritaVencida,
  funcoesDoTexto,
  funcoesNormalizadas,
  iniciaisDoNome,
  prazoDaEscrita,
  prazoDoProtocolo,
  prazoVigente,
  type ProtocoloParaAcoes,
  protocoloVencido,
  prorrogavelAte,
  recusaDaAcao,
  type RegistroProtocoloConferir,
  textoDaRespostaEscrita,
  validadeDaAtivacao,
} from './atendimento.js';
import { protocoloAtendimento } from './autorizacao.js';

// 2026-10-26 é segunda-feira.
const SEG = '2026-10-26T10:00:00';

const codigos = (p: readonly { codigo: string }[]) => p.map((x) => x.codigo);

describe('classe e prazo da resposta (D-PRAZO-PROT-568)', () => {
  it('as naturezas assistenciais e as não assistenciais', () => {
    expect(classeDaNatureza('cobertura')).toBe('assistencial');
    expect(classeDaNatureza('reembolso')).toBe('assistencial');
    expect(classeDaNatureza('reclamacao-assistencial')).toBe('assistencial');
    expect(classeDaNatureza('financeiro')).toBe('nao-assistencial');
    expect(classeDaNatureza('cancelamento')).toBe('nao-assistencial');
  });

  const base = { instancia: 'atendimento', urgente: false, altaComplexidade: false } as const;

  it('assistencial: 5 dias úteis (sem fim de semana); alta complexidade da cobertura: 10', () => {
    expect(prazoDoProtocolo({ ...base, natureza: 'cobertura' }, SEG)).toEqual({
      tipo: 'assistencial',
      prazoEm: '2026-11-02T23:59:59',
    });
    expect(prazoDoProtocolo({ ...base, natureza: 'cobertura', altaComplexidade: true }, SEG)).toEqual({
      tipo: 'complexo',
      prazoEm: '2026-11-09T23:59:59',
    });
    // Alta complexidade só muda o prazo da cobertura.
    expect(prazoDoProtocolo({ ...base, natureza: 'reembolso', altaComplexidade: true }, SEG).tipo).toBe(
      'assistencial',
    );
  });

  it('urgência assistencial e cancelamento do contrato: imediato', () => {
    expect(
      prazoDoProtocolo({ ...base, natureza: 'cobertura', urgente: true }, '2026-10-26 10:00:00'),
    ).toEqual({
      tipo: 'imediato',
      prazoEm: SEG,
    });
    expect(prazoDoProtocolo({ ...base, natureza: 'cancelamento' }, SEG).tipo).toBe('imediato');
    // Urgência não vale na não assistencial.
    expect(prazoDoProtocolo({ ...base, natureza: 'financeiro', urgente: true }, SEG).tipo).toBe(
      'nao-assistencial',
    );
  });

  it('não assistencial: 7 dias úteis; ouvidoria: 7; NIP: 5 ou 10', () => {
    expect(prazoDoProtocolo({ ...base, natureza: 'cadastro' }, SEG)).toEqual({
      tipo: 'nao-assistencial',
      prazoEm: '2026-11-04T23:59:59',
    });
    expect(prazoDoProtocolo({ ...base, instancia: 'ouvidoria', natureza: 'cobertura' }, SEG).tipo).toBe(
      'ouvidoria',
    );
    expect(prazoDoProtocolo({ ...base, instancia: 'nip', natureza: 'cobertura' }, SEG)).toEqual({
      tipo: 'nip-assistencial',
      prazoEm: '2026-11-02T23:59:59',
    });
    expect(prazoDoProtocolo({ ...base, instancia: 'nip', natureza: 'financeiro' }, SEG)).toEqual({
      tipo: 'nip-nao-assistencial',
      prazoEm: '2026-11-09T23:59:59',
    });
  });

  it('o prazo vigente é o prorrogado; vencido só em aberto', () => {
    const p = { situacao: 'aberto', prazoEm: '2026-10-27T23:59:59', prorrogadoAte: null } as const;
    expect(prazoVigente(p)).toBe('2026-10-27T23:59:59');
    expect(protocoloVencido(p, '2026-10-28T00:00:00')).toBe(true);
    expect(protocoloVencido(p, '2026-10-27T23:59:59')).toBe(false);
    expect(protocoloVencido({ ...p, prorrogadoAte: '2026-11-10T23:59:59' }, '2026-10-28T00:00:00')).toBe(
      false,
    );
    expect(protocoloVencido({ ...p, situacao: 'respondido' }, '2026-12-01T00:00:00')).toBe(false);
  });

  it('o protocolo do atendimento tem a montagem da autorização (20 dígitos)', () => {
    expect(protocoloAtendimento('999991', '2026-10-26', 42)).toBe('99999120261026000042');
  });
});

describe('conferência do registro', () => {
  const ok: RegistroProtocoloConferir = {
    instancia: 'atendimento',
    natureza: 'cobertura',
    canal: 'telefone',
    solicitante: 'beneficiario',
    carteirinha: '1234567890123456',
    solicitanteNome: null,
    numeroNip: null,
    urgente: false,
    altaComplexidade: false,
    temAutorizacao: false,
    temOrigemProtocolo: false,
  };

  it('o registro completo do beneficiário passa', () => {
    expect(conferirRegistroProtocolo(ok)).toEqual([]);
  });

  it('sem carteirinha só a informação pedida por quem não é beneficiário', () => {
    expect(codigos(conferirRegistroProtocolo({ ...ok, carteirinha: null }))).toEqual([
      'carteirinha-obrigatoria',
    ]);
    expect(
      codigos(
        conferirRegistroProtocolo({
          ...ok,
          natureza: 'informacao',
          carteirinha: null,
          solicitante: 'beneficiario',
        }),
      ),
    ).toEqual(['sem-beneficiario-so-informacao']);
    expect(
      conferirRegistroProtocolo({
        ...ok,
        natureza: 'informacao',
        carteirinha: null,
        solicitante: 'outro',
        solicitanteNome: 'Fulano Sintético',
      }),
    ).toEqual([]);
  });

  it('quem não é o beneficiário (nem a ANS) informa o nome', () => {
    expect(codigos(conferirRegistroProtocolo({ ...ok, solicitante: 'representante' }))).toEqual([
      'solicitante-nome-obrigatorio',
    ]);
  });

  it('NIP: canal e solicitante ANS e o número; fora da NIP, nada da ANS', () => {
    expect(
      codigos(
        conferirRegistroProtocolo({
          ...ok,
          instancia: 'nip',
          canal: 'telefone',
          solicitante: 'beneficiario',
        }),
      ),
    ).toEqual(['canal-da-ans', 'nip-sem-numero']);
    expect(
      conferirRegistroProtocolo({
        ...ok,
        instancia: 'nip',
        canal: 'ans',
        solicitante: 'ans',
        numeroNip: '1234567',
      }),
    ).toEqual([]);
    expect(codigos(conferirRegistroProtocolo({ ...ok, canal: 'ans', numeroNip: '1234567' }))).toEqual([
      'ans-so-na-nip',
      'numero-nip-so-na-nip',
    ]);
  });

  it('o canal do portal é do prestador, e o prestador só pelo portal', () => {
    expect(codigos(conferirRegistroProtocolo({ ...ok, canal: 'portal-prestador' }))).toEqual([
      'portal-so-prestador',
    ]);
    expect(
      codigos(
        conferirRegistroProtocolo({ ...ok, solicitante: 'prestador', solicitanteNome: 'Clínica Sintética' }),
      ),
    ).toEqual(['portal-so-prestador']);
  });

  it('urgência, complexidade, guia e origem nas demandas certas', () => {
    expect(
      codigos(
        conferirRegistroProtocolo({
          ...ok,
          natureza: 'financeiro',
          urgente: true,
          altaComplexidade: true,
          temAutorizacao: true,
          temOrigemProtocolo: true,
        }),
      ),
    ).toEqual([
      'urgente-so-assistencial',
      'complexidade-so-cobertura',
      'autorizacao-so-cobertura',
      'origem-so-ouvidoria',
    ]);
  });

  it('a origem da reanálise: do atendimento, respondida e sem outra em aberto', () => {
    expect(
      codigos(
        conferirOrigemDaReanalise({
          instancia: 'ouvidoria',
          situacao: 'respondido',
          reanaliseEmAberto: false,
        }),
      ),
    ).toEqual(['reanalise-da-ouvidoria']);
    expect(
      codigos(
        conferirOrigemDaReanalise({ instancia: 'atendimento', situacao: 'aberto', reanaliseEmAberto: false }),
      ),
    ).toEqual(['origem-protocolo-sem-resposta']);
    expect(
      codigos(
        conferirOrigemDaReanalise({
          instancia: 'atendimento',
          situacao: 'encerrado',
          reanaliseEmAberto: true,
        }),
      ),
    ).toEqual(['reanalise-ja-aberta']);
    expect(
      conferirOrigemDaReanalise({ instancia: 'nip', situacao: 'respondido', reanaliseEmAberto: false }),
    ).toEqual([]);
  });
});

describe('prorrogação, resposta e escrita', () => {
  const ouv = {
    instancia: 'ouvidoria',
    situacao: 'aberto',
    abertoEm: SEG,
    prazoEm: '2026-11-04T23:59:59',
    prorrogadoAte: null,
  } as const;

  it('só a ouvidoria em aberto prorroga, uma vez, até 30 dias úteis do registro', () => {
    expect(prorrogavelAte(ouv)).toBe('2026-12-07T23:59:59');
    expect(prorrogavelAte({ ...ouv, instancia: 'atendimento' })).toBeNull();
    expect(prorrogavelAte({ ...ouv, prorrogadoAte: '2026-11-20T23:59:59' })).toBeNull();
    expect(prorrogavelAte({ ...ouv, situacao: 'respondido' })).toBeNull();
    expect(conferirProrrogacao(ouv, '2026-11-20')).toEqual({
      problemas: [],
      prorrogadoAte: '2026-11-20T23:59:59',
    });
    expect(codigos(conferirProrrogacao({ ...ouv, instancia: 'nip' }, '2026-11-20').problemas)).toEqual([
      'prorrogacao-so-ouvidoria',
    ]);
    expect(
      codigos(conferirProrrogacao({ ...ouv, prorrogadoAte: '2026-11-20T23:59:59' }, '2026-11-25').problemas),
    ).toEqual(['prorrogacao-ja-feita']);
    expect(codigos(conferirProrrogacao({ ...ouv, situacao: 'encerrado' }, '2026-11-20').problemas)).toEqual([
      'situacao-nao-permite',
    ]);
    expect(codigos(conferirProrrogacao(ouv, '2026-11-04').problemas)).toEqual(['prorrogacao-antes-do-prazo']);
    expect(codigos(conferirProrrogacao(ouv, '2026-12-08').problemas)).toEqual([
      'prorrogacao-acima-do-limite',
    ]);
  });

  it('a resposta conclusiva da demanda assistencial; o fundamento da negativa', () => {
    expect(
      codigos(conferirResposta({ natureza: 'cobertura', conclusao: 'informativa', fundamento: null })),
    ).toEqual(['informativa-so-nao-assistencial']);
    expect(
      codigos(conferirResposta({ natureza: 'cobertura', conclusao: 'parcial', fundamento: null })),
    ).toEqual(['fundamento-obrigatorio']);
    expect(
      conferirResposta({ natureza: 'cobertura', conclusao: 'desfavoravel', fundamento: 'Cláusula 7' }),
    ).toEqual([]);
    expect(conferirResposta({ natureza: 'informacao', conclusao: 'informativa', fundamento: null })).toEqual(
      [],
    );
  });

  it('a escrita sai em 24 horas da resposta ou do pedido, o que vier depois', () => {
    expect(prazoDaEscrita('2026-10-26T10:00:00', '2026-10-26T09:00:00')).toBe('2026-10-27T10:00:00');
    expect(prazoDaEscrita('2026-10-26T10:00:00', '2026-10-28 08:30:00')).toBe('2026-10-29T08:30:00');
    const p = { escritaPedida: true, escritaEnviadaEm: null, escritaPrazoEm: '2026-10-27T10:00:00' };
    expect(escritaPendente(p)).toBe(true);
    expect(escritaVencida(p, '2026-10-27T10:00:01')).toBe(true);
    expect(escritaVencida(p, '2026-10-27T09:00:00')).toBe(false);
    expect(escritaVencida({ ...p, escritaPrazoEm: null }, '2026-12-01T00:00:00')).toBe(false);
    expect(escritaPendente({ ...p, escritaEnviadaEm: '2026-10-26T12:00:00' })).toBe(false);
  });
});

describe('ações do protocolo', () => {
  const p: ProtocoloParaAcoes = {
    instancia: 'atendimento',
    situacao: 'aberto',
    conclusao: null,
    abertoEm: SEG,
    prazoEm: '2026-11-02T23:59:59',
    prorrogadoAte: null,
    escritaPedida: false,
    escritaPrazoEm: null,
    escritaEnviadaEm: null,
    reanaliseEmAberto: false,
  };

  it('em aberto: analisar, interagir, responder, pedir a escrita e cancelar', () => {
    expect(acoesDoProtocolo(p)).toEqual(['analisar', 'interagir', 'responder', 'pedirEscrita', 'cancelar']);
    expect(acoesDoProtocolo({ ...p, instancia: 'ouvidoria', situacao: 'em-analise' })).toEqual([
      'interagir',
      'prorrogar',
      'responder',
      'pedirEscrita',
      'cancelar',
    ]);
  });

  it('respondido: a escrita pendente segura o encerramento; a negativa abre a reanálise', () => {
    const r = { ...p, situacao: 'respondido', conclusao: 'desfavoravel', escritaPedida: true } as const;
    expect(acoesDoProtocolo(r)).toEqual(['interagir', 'enviarEscrita', 'reanalise']);
    expect(acoesDoProtocolo({ ...r, escritaEnviadaEm: '2026-10-26T12:00:00' })).toEqual([
      'interagir',
      'encerrar',
      'reanalise',
    ]);
    expect(acoesDoProtocolo({ ...r, situacao: 'encerrado', reanaliseEmAberto: true })).toEqual([]);
    expect(acoesDoProtocolo({ ...r, conclusao: 'favoravel', escritaPedida: false })).toEqual([
      'interagir',
      'pedirEscrita',
      'encerrar',
    ]);
  });

  it('a recusa de cada ação fora de hora', () => {
    expect(recusaDaAcao(p, 'responder')).toBeNull();
    expect(recusaDaAcao(p, 'prorrogar')).toBe('prorrogacao-so-ouvidoria');
    expect(
      recusaDaAcao({ ...p, instancia: 'ouvidoria', prorrogadoAte: '2026-11-20T23:59:59' }, 'prorrogar'),
    ).toBe('prorrogacao-ja-feita');
    expect(recusaDaAcao({ ...p, instancia: 'ouvidoria', situacao: 'respondido' }, 'prorrogar')).toBe(
      'situacao-nao-permite',
    );
    expect(recusaDaAcao({ ...p, escritaPedida: true }, 'pedirEscrita')).toBe('escrita-ja-pedida');
    expect(recusaDaAcao({ ...p, situacao: 'respondido' }, 'enviarEscrita')).toBe('escrita-nao-pedida');
    expect(recusaDaAcao(p, 'enviarEscrita')).toBe('escrita-antes-da-resposta');
    expect(recusaDaAcao({ ...p, situacao: 'respondido', escritaPedida: true }, 'encerrar')).toBe(
      'escrita-pendente',
    );
    expect(
      recusaDaAcao({ ...p, instancia: 'nip', situacao: 'respondido', conclusao: 'parcial' }, 'reanalise'),
    ).toBe('reanalise-da-ouvidoria');
    expect(
      recusaDaAcao(
        { ...p, situacao: 'respondido', conclusao: 'parcial', reanaliseEmAberto: true },
        'reanalise',
      ),
    ).toBe('reanalise-ja-aberta');
    expect(recusaDaAcao({ ...p, situacao: 'cancelado' }, 'reanalise')).toBe('situacao-nao-permite');
    expect(recusaDaAcao({ ...p, situacao: 'encerrado' }, 'cancelar')).toBe('situacao-nao-permite');
  });
});

describe('texto da resposta por escrito', () => {
  const x = {
    operadoraNome: 'Operadora Sintética',
    registroAns: '999991',
    protocolo: '99999120261026000042',
    instancia: 'atendimento',
    natureza: 'cobertura',
    abertoEm: SEG,
    assunto: 'Pedido de ressonância',
    conclusao: 'desfavoravel',
    resposta: 'O procedimento não consta do rol para a segmentação do plano.',
    fundamento: 'Cláusula 7.2 do contrato',
    respondidoEm: '2026-10-28T09:00:00',
  } as const;

  it('o protocolo legível, a data, a conclusão, o fundamento e a reanálise', () => {
    const t = textoDaRespostaEscrita(x);
    expect(t).toContain('protocolo 999991 20261026 000042, aberto em 26/10/2026');
    expect(t).toContain('Resposta de 28/10/2026: Desfavorável ao beneficiário.');
    expect(t).toContain('Fundamento: Cláusula 7.2 do contrato.');
    expect(t).toContain('reanálise');
  });

  it('a favorável e a da ouvidoria não falam de reanálise', () => {
    expect(textoDaRespostaEscrita({ ...x, conclusao: 'favoravel', fundamento: null })).not.toContain(
      'reanálise',
    );
    expect(textoDaRespostaEscrita({ ...x, instancia: 'ouvidoria' })).not.toContain('reanálise');
  });
});

describe('acesso ao portal do prestador (D-PORTAL-FUNCOES-568, D-PORTAL-ACESSO-568)', () => {
  const dominio = [1, 2, 3, 4, 5, 6, 7, 8];

  it('só as funções liberáveis do domínio; cancelar com solicitar', () => {
    expect(conferirFuncoesPortal([1, 2, 3, 7], dominio)).toEqual([]);
    expect(codigos(conferirFuncoesPortal([4], dominio))).toEqual(['funcao-nao-liberavel']);
    expect(codigos(conferirFuncoesPortal([9], dominio))).toEqual(['funcao-inexistente']);
    expect(codigos(conferirFuncoesPortal([2, 3], dominio))).toEqual(['cancelar-sem-solicitar']);
  });

  it('as funções guardadas em texto, em ordem e sem repetição', () => {
    expect(funcoesNormalizadas([7, 1, 3, 1])).toEqual([1, 3, 7]);
    expect(funcoesDoTexto('1, 3,7,x,')).toEqual([1, 3, 7]);
    expect(funcoesDoTexto(null)).toEqual([]);
  });

  it('validade da ativação, tentativas e bloqueio', () => {
    expect(validadeDaAtivacao(SEG)).toBe('2026-10-29T10:00:00');
    expect(depoisDaTentativaPortal(3, true, SEG)).toEqual({ tentativas: 0, bloqueadoAte: null });
    expect(depoisDaTentativaPortal(3, false, SEG)).toEqual({ tentativas: 4, bloqueadoAte: null });
    expect(depoisDaTentativaPortal(4, false, SEG)).toEqual({
      tentativas: 0,
      bloqueadoAte: '2026-10-26T10:15:00',
    });
    expect(acessoBloqueado('2026-10-26T10:15:00', SEG)).toBe(true);
    expect(acessoBloqueado('2026-10-26T10:15:00', '2026-10-26T10:15:00')).toBe(false);
    expect(acessoBloqueado(null, SEG)).toBe(false);
  });

  it('as iniciais do beneficiário', () => {
    expect(iniciaisDoNome('  maria da silva SINTÉTICA ')).toBe('M. S. S.');
    expect(iniciaisDoNome('')).toBe('');
  });
});
