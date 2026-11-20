// Regra 9a do M08 (POL-3; ADR 0019): ligar recusado sem o pré-requisito; aceito com ele; desligar sempre.
import { RECURSOS_DESLIGADOS } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { decidirChave, diaEmSaoPaulo, faltasDoRecurso } from './prerequisito-chave.js';

const esocial = RECURSOS_DESLIGADOS.find((r) => r.chave === 'pessoas.esocial')!;
const agora = new Date('2026-10-20T12:00:00Z');

describe('pré-requisito × chave (POL-3)', () => {
  it('ligar sem o pré-requisito registrado é recusado e diz o que falta', () => {
    const d = decidirChave(true, esocial.prerequisitos, [], agora);
    expect(d.permitido).toBe(false);
    if (!d.permitido) {
      expect(d.faltas).toEqual([
        { tipo: 'certificado', descricao: esocial.prerequisitos[0]!.descricao, motivo: 'sem-registro' },
      ]);
      expect(d.mensagem).toMatch(/Certificado digital do empregador.*não registrado/);
    }
  });
  it('pendente e vencido são falta; cumprido válido e dispensado ligam', () => {
    expect(
      decidirChave(
        true,
        esocial.prerequisitos,
        [{ tipo: 'certificado', situacao: 'pendente', validade: null }],
        agora,
      ).permitido,
    ).toBe(false);
    const vencido = decidirChave(
      true,
      esocial.prerequisitos,
      [{ tipo: 'certificado', situacao: 'cumprido', validade: '2026-10-19' }],
      agora,
    );
    expect(vencido.permitido).toBe(false);
    if (!vencido.permitido) expect(vencido.mensagem).toMatch(/vencido/);
    expect(
      decidirChave(
        true,
        esocial.prerequisitos,
        [{ tipo: 'certificado', situacao: 'cumprido', validade: '2026-10-20' }],
        agora,
      ),
    ).toEqual({ permitido: true });
    expect(
      decidirChave(
        true,
        esocial.prerequisitos,
        [{ tipo: 'certificado', situacao: 'cumprido', validade: null }],
        agora,
      ),
    ).toEqual({ permitido: true });
    expect(
      decidirChave(
        true,
        esocial.prerequisitos,
        [{ tipo: 'certificado', situacao: 'dispensado', validade: null }],
        agora,
      ),
    ).toEqual({ permitido: true });
  });
  it('desligar é sempre permitido, mesmo com pré-requisito faltando', () => {
    expect(decidirChave(false, esocial.prerequisitos, [], agora)).toEqual({ permitido: true });
  });
  it('recurso sem pré-requisito liga direto', () => {
    expect(faltasDoRecurso([], [], agora)).toEqual([]);
  });
  it('o dia é o de São Paulo (o processo roda em UTC)', () => {
    expect(diaEmSaoPaulo(new Date('2026-10-21T02:00:00Z'))).toBe('2026-10-20');
  });
  it('todo recurso desligado tem chave, título, decisão e marco (catálogo POL-3)', () => {
    for (const r of RECURSOS_DESLIGADOS) {
      // M34: dígito no segmento (`integracao.hl7`).
      expect(r.chave).toMatch(/^[a-z]+(?:\.[a-zA-Z][a-zA-Z0-9]*)*$/);
      expect(r.titulo.length).toBeGreaterThan(3);
      // Marco da obra (M10…M50) ou pacote do programa CRUD (W1-01…).
      expect(r.marco).toMatch(/^(?:M\d\d|W\d-\d\d)$/);
    }
  });

  // M29 (regras 9 e 10): a chave do livro oficial de controlados não liga sem a aprovação da VISA registrada; a da
  // farmácia ambulatorial (SNGPC) não liga sem o CNAE de farmácia e o credenciamento no SNGPC.
  it('livro de controlados oficial: sem a aprovação da VISA não liga; com ela, liga', () => {
    const livro = RECURSOS_DESLIGADOS.find((r) => r.chave === 'suprimentos.livroControlados')!;
    expect(livro.marco).toBe('M29');
    const sem = decidirChave(true, livro.prerequisitos, [], agora);
    expect(sem.permitido).toBe(false);
    if (!sem.permitido) expect(sem.mensagem).toMatch(/Vigilância Sanitária/);
    expect(
      decidirChave(
        true,
        livro.prerequisitos,
        [{ tipo: 'aprovacao', situacao: 'cumprido', validade: null }],
        agora,
      ).permitido,
    ).toBe(true);
  });
  it('farmácia ambulatorial (SNGPC): falta o CNAE ou o credenciamento, não liga; os dois, liga', () => {
    const amb = RECURSOS_DESLIGADOS.find((r) => r.chave === 'suprimentos.ambulatorial')!;
    expect(amb.prerequisitos.map((x) => x.tipo)).toEqual(['aprovacao', 'credenciamento']);
    expect(amb.prerequisitos[0]!.descricao).toMatch(/CNAE de farmácia/);
    const so = decidirChave(
      true,
      amb.prerequisitos,
      [{ tipo: 'aprovacao', situacao: 'cumprido', validade: null }],
      agora,
    );
    expect(so.permitido).toBe(false);
    if (!so.permitido) expect(so.mensagem).toMatch(/SNGPC/);
    expect(
      decidirChave(
        true,
        amb.prerequisitos,
        [
          { tipo: 'aprovacao', situacao: 'cumprido', validade: null },
          { tipo: 'credenciamento', situacao: 'cumprido', validade: '2027-12-31' },
        ],
        agora,
      ).permitido,
    ).toBe(true);
    expect(decidirChave(false, amb.prerequisitos, [], agora).permitido).toBe(true);
  });

  // M50 etapa 1 (seção 12): o portal do paciente não liga sem a aprovação do encarregado de dados (termos, regras do
  // responsável legal, relatório de acessos) e o teste de invasão da superfície pública.
  it('portal do paciente: sem a aprovação do DPO não liga; com ela, liga; desligar sempre', () => {
    const portal = RECURSOS_DESLIGADOS.find((r) => r.chave === 'portal.conta')!;
    expect(portal.marco).toBe('M50');
    const sem = decidirChave(true, portal.prerequisitos, [], agora);
    expect(sem.permitido).toBe(false);
    if (!sem.permitido) expect(sem.mensagem).toMatch(/encarregado de dados/);
    expect(
      decidirChave(
        true,
        portal.prerequisitos,
        [{ tipo: 'aprovacao', situacao: 'cumprido', validade: null }],
        agora,
      ).permitido,
    ).toBe(true);
    expect(decidirChave(false, portal.prerequisitos, [], agora).permitido).toBe(true);
  });
  // M55, etapa 4 (regra 9; DP-13): a licitação nasce desligada e não liga sem a unidade pública (ou o regulamento
  // próprio aprovado) e o parecer do jurídico; desligar, sempre.
  it('licitacao: sem a aprovação conjunta da diretoria e do jurídico não liga; com ela, liga; desligar sempre', () => {
    const lic = RECURSOS_DESLIGADOS.find((r) => r.chave === 'licitacao')!;
    expect(lic.marco).toBe('M55');
    // Um pré-requisito por tipo (o registro casa pelo tipo): dois de 'aprovacao' se cumpririam com um registro só.
    const tipos = lic.prerequisitos.map((p) => p.tipo);
    expect(new Set(tipos).size).toBe(tipos.length);
    expect(lic.prerequisitos.map((p) => p.responsavel)).toEqual(['diretoria administrativa e jurídico']);
    const sem = decidirChave(true, lic.prerequisitos, [], agora);
    expect(sem.permitido).toBe(false);
    if (!sem.permitido) {
      expect(sem.faltas).toHaveLength(1);
      expect(sem.mensagem).toMatch(/regulamento próprio de compras/);
      expect(sem.mensagem).toMatch(/parecer do jurídico/);
    }
    expect(
      decidirChave(
        true,
        lic.prerequisitos,
        [{ tipo: 'aprovacao', situacao: 'pendente', validade: null }],
        agora,
      ).permitido,
    ).toBe(false);
    expect(
      decidirChave(
        true,
        lic.prerequisitos,
        [{ tipo: 'aprovacao', situacao: 'cumprido', validade: null }],
        agora,
      ).permitido,
    ).toBe(true);
    expect(decidirChave(false, lic.prerequisitos, [], agora).permitido).toBe(true);
  });
});

// M49 (regra 10 e seção 12): a receita nato-digital com numeração SNCR não liga sem o credenciamento no SNCR; a
// assinatura ICP não liga sem o provedor contratado e a política aprovada (DP-22).
describe('pré-requisitos do M49', () => {
  it('receita.sncr: sem o credenciamento no SNCR não liga; com ele, liga', () => {
    const sncr = RECURSOS_DESLIGADOS.find((r) => r.chave === 'receita.sncr')!;
    expect(sncr.marco).toBe('M49');
    expect(sncr.prerequisitos.map((x) => x.tipo)).toEqual(['credenciamento']);
    const sem = decidirChave(true, sncr.prerequisitos, [], agora);
    expect(sem.permitido).toBe(false);
    if (!sem.permitido) expect(sem.mensagem).toMatch(/SNCR/);
    expect(
      decidirChave(
        true,
        sncr.prerequisitos,
        [{ tipo: 'credenciamento', situacao: 'pendente', validade: null }],
        agora,
      ).permitido,
    ).toBe(false);
    expect(
      decidirChave(
        true,
        sncr.prerequisitos,
        [{ tipo: 'credenciamento', situacao: 'cumprido', validade: null }],
        agora,
      ).permitido,
    ).toBe(true);
  });
  it('assinatura.icp: falta o contrato do provedor ou a aprovação da política, não liga; os dois, liga', () => {
    const icp = RECURSOS_DESLIGADOS.find((r) => r.chave === 'assinatura.icp')!;
    expect(icp.marco).toBe('M49');
    expect(icp.prerequisitos.map((x) => x.tipo)).toEqual(['contrato', 'aprovacao']);
    const so = decidirChave(
      true,
      icp.prerequisitos,
      [{ tipo: 'contrato', situacao: 'cumprido', validade: '2027-12-31' }],
      agora,
    );
    expect(so.permitido).toBe(false);
    if (!so.permitido) expect(so.mensagem).toMatch(/DP-22/);
    expect(
      decidirChave(
        true,
        icp.prerequisitos,
        [
          { tipo: 'contrato', situacao: 'cumprido', validade: '2027-12-31' },
          { tipo: 'aprovacao', situacao: 'cumprido', validade: null },
        ],
        agora,
      ).permitido,
    ).toBe(true);
    expect(decidirChave(false, icp.prerequisitos, [], agora).permitido).toBe(true);
  });
});
