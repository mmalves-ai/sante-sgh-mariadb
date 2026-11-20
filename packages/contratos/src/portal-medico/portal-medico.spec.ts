// Contratos do portal do médico externo (M50, etapa 3): a entrada do pedido de cirurgia (o paciente informado em
// maiúsculas e sem espaço repetido, CP1252, estrita), a retirada, o vínculo, as permissões (internas pela opção do outro
// sistema; as do portal só pelo perfil da sessão do portal), os eventos sem legado e a chave desligada com o
// pré-requisito do DPO e do bloco.
import { describe, expect, it } from 'vitest';
import { CATALOGO_EVENTOS, EVENTOS_AUDITAVEIS } from '../auditoria/eventos.js';
import { RECURSOS_DESLIGADOS } from '../liberacao/recursos.js';
import {
  PERFIS_SESSAO_PORTAL_MEDICO,
  PERMISSOES_CODIGOS_PORTAL_MEDICO,
  PERMISSOES_PORTAL_MEDICO_M50,
} from '../permissoes/portal-medico.js';
import {
  CHAVE_PORTAL_MEDICO,
  esquemaConfirmarTrocaEmailMedico,
  esquemaPedidoCirurgiaPortal,
  esquemaPedirTrocaEmailMedico,
  esquemaRetirarPedidoPortal,
  esquemaAlterarPedidoPortal,
  esquemaCienciaCriticoMedico,
  esquemaTrocarSenhaMedico,
  esquemaVincularMedicoExterno,
} from './portal-medico.js';

const pedido = {
  sala: 2,
  data: '2026-11-03',
  hora: '1400',
  duracaoMin: 90,
  procedimento: 30101271,
  convenio: 10,
  paciente: { nome: '  maria   da silva ', nascimento: '1970-05-02' },
};

describe('pedido de cirurgia pelo portal', () => {
  it('normaliza o nome do paciente e aplica os padrões de caráter e anestesia', () => {
    const p = esquemaPedidoCirurgiaPortal.parse(pedido);
    expect(p.paciente.nome).toBe('MARIA DA SILVA');
    expect(p.carater).toBe(2);
    expect(p.anestesia).toBe(0);
  });
  it.each([
    [{ ...pedido, paciente: { nome: 'ANA', nascimento: '1970-05-02' } }],
    [{ ...pedido, paciente: { nome: 'MARIA DA SILVA', nascimento: '02/05/1970' } }],
    [{ ...pedido, hora: '14:00' }],
    [{ ...pedido, sala: 0 }],
    [{ ...pedido, cirurgiao: 5001 }],
    [{ ...pedido, paciente: { nome: 'MARIA 😀 SILVA', nascimento: '1970-05-02' } }],
  ])('recusa a entrada inválida %#', (x) => {
    expect(esquemaPedidoCirurgiaPortal.safeParse(x).success).toBe(false);
  });
  it('a retirada e o vínculo são estritos', () => {
    expect(esquemaRetirarPedidoPortal.parse({})).toEqual({});
    expect(esquemaRetirarPedidoPortal.safeParse({ motivo: 'x', id: 1 }).success).toBe(false);
    expect(esquemaVincularMedicoExterno.parse({ profissional: 6801 })).toEqual({ profissional: 6801 });
    expect(esquemaVincularMedicoExterno.safeParse({ profissional: 0 }).success).toBe(false);
  });
});

describe('W0-10: alteração do pedido não confirmado', () => {
  it('exige o pedido inteiro, a versão vista e o motivo; normaliza como o pedido', () => {
    const a = esquemaAlterarPedidoPortal.parse({ ...pedido, versao: 1, motivo: '  troca   de sala ' });
    expect(a.motivo).toBe('troca de sala');
    expect(a.paciente.nome).toBe('MARIA DA SILVA');
    expect(esquemaAlterarPedidoPortal.safeParse({ ...pedido, motivo: 'troca de sala' }).success).toBe(false);
    expect(
      esquemaAlterarPedidoPortal.safeParse({ ...pedido, versao: 0, motivo: 'troca de sala' }).success,
    ).toBe(false);
    expect(esquemaAlterarPedidoPortal.safeParse({ ...pedido, versao: 1, motivo: 'abc' }).success).toBe(false);
    expect(
      esquemaAlterarPedidoPortal.safeParse({ ...pedido, versao: 1, motivo: 'troca', id: 3 }).success,
    ).toBe(false);
  });
});

describe('permissões, eventos e chave', () => {
  it('as internas pela opção do outro sistema; as do portal só pelo perfil da sessão do portal', () => {
    const P = PERMISSOES_CODIGOS_PORTAL_MEDICO;
    const por = new Map(PERMISSOES_PORTAL_MEDICO_M50.map((p) => [p.codigo, p]));
    expect(por.get(P.contasLer)?.opcoesLegado).toEqual([4748]);
    expect(por.get(P.vincular)).toMatchObject({ opcoesLegado: [4748], criticidade: 'sensivel' });
    for (const c of [P.extratoLer, P.agendaLer, P.cirurgiaPedir, P.pacientesLer])
      expect(por.get(c)).toMatchObject({
        opcoesLegado: [],
        concessaoPorPerfil: 'por-perfil',
        perfis: PERFIS_SESSAO_PORTAL_MEDICO,
      });
  });
  it('os eventos do portal do médico existem, sem trilha do legado, e não repetem código', () => {
    const doMedico = CATALOGO_EVENTOS.filter((e) => e.codigo.startsWith('portal.medico.'));
    expect(doMedico.map((e) => e.codigo).sort()).toEqual(
      [
        'portal.medico.agendaLida',
        'portal.medico.cirurgiaPedida',
        'portal.medico.contasLidas',
        'portal.medico.extratoLido',
        'portal.medico.desvinculado',
        'portal.medico.pedidoRetirado',
        'portal.medico.vinculado',
        'portal.medico.contaBloqueada',
        'portal.medico.contaDesbloqueada',
        'portal.medico.contaEncerrada',
        'portal.medico.pedidoRetiradoNoEncerramento',
        'portal.medico.senhaTrocada',
        'portal.medico.emailTrocaPedida',
        'portal.medico.emailTrocado',
        'portal.medico.pedidoAlterado',
        'portal.medico.pacientesLidos',
        'portal.medico.prontuarioAcessado',
        'portal.medico.criticosLidos',
        'portal.medico.criticoNotificado',
        'portal.medico.criticoCiente',
        'portal.medico.assinaturasLidas',
        'portal.medico.assinaturaPedida',
        'portal.medico.assinaturaConcluida',
      ].sort(),
    );
    expect(doMedico.every((e) => e.legado === null)).toBe(true);
    expect(EVENTOS_AUDITAVEIS.portalMedicoCirurgiaPedida.codigo).toBe('portal.medico.cirurgiaPedida');
  });
  it('a chave existe, é do M50 e tem o pré-requisito do DPO e do bloco, sem nome de outro sistema', () => {
    const r = RECURSOS_DESLIGADOS.find((x) => x.chave === CHAVE_PORTAL_MEDICO)!;
    expect(r.marco).toBe('M50');
    expect(r.prerequisitos).toHaveLength(1);
    expect(r.prerequisitos[0]?.responsavel).toMatch(/DPO/);
    expect(`${r.titulo} ${r.descricao}`).not.toMatch(/SPDATA|legado|sistema atual/i);
  });
});

describe('W0-10: troca da senha e do e-mail do médico', () => {
  it('a senha nova tem 10+ caracteres, confere com a confirmação e difere da atual; o e-mail é normalizado', () => {
    const base = {
      atual: 'senha-atual-x',
      nova: 'senha-nova-123',
      confirmacao: 'senha-nova-123',
      codigo: '123456',
    };
    expect(esquemaTrocarSenhaMedico.safeParse(base).success).toBe(true);
    expect(esquemaTrocarSenhaMedico.safeParse({ ...base, nova: 'curta', confirmacao: 'curta' }).success).toBe(
      false,
    );
    expect(esquemaTrocarSenhaMedico.safeParse({ ...base, confirmacao: 'outra-senha-1' }).success).toBe(false);
    expect(
      esquemaTrocarSenhaMedico.safeParse({ ...base, nova: base.atual, confirmacao: base.atual }).success,
    ).toBe(false);
    const e = esquemaPedirTrocaEmailMedico.parse({
      email: ' Novo@Exemplo.Invalid ',
      senha: 'x',
      codigo: '123456',
    });
    expect(e.email).toBe('novo@exemplo.invalid');
    expect(esquemaConfirmarTrocaEmailMedico.safeParse({ token: 'curto' }).success).toBe(false);
  });
});

describe('W0-10 (M5): ciência do crítico pelo médico externo', () => {
  it('exige a conduta (5+ caracteres, normalizada) e nada além dela', () => {
    expect(esquemaCienciaCriticoMedico.parse({ conduta: '  repetir   o exame ' }).conduta).toBe(
      'repetir o exame',
    );
    expect(esquemaCienciaCriticoMedico.safeParse({ conduta: 'ok' }).success).toBe(false);
    expect(esquemaCienciaCriticoMedico.safeParse({ conduta: 'repetir o exame', aviso: 1 }).success).toBe(
      false,
    );
  });
});
