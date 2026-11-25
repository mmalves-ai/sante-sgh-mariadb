// C1-092 (F3.5, 05-SADT linha 14): a remessa ao laboratório de apoio e o de-para chegam ao pessoal do laboratório.
// O perfil complementar próprio `laboratorio-apoio` concede sadt.apoio.ler, sadt.apoio.remessa e
// sadt.apoio.configurar (antes só o administrador do sistema), sem dar a conferência do resultado que volta
// (sadt.apoio.conferir, privativa do responsável técnico com conselho). O cálculo é o mesmo da sessão.
import 'reflect-metadata';
import { PERFIS_COMPLEMENTARES, PERMISSOES_M34 } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { calcularAutorizacao } from '../../autorizacao/servico-autorizacao.js';
import { CHAVE_AUDITADO_NO_HANDLER, CHAVE_PERMISSAO } from '../../autorizacao/decoradores.js';
import { CONTAS_SINTETICAS } from '../acesso/fonte-sintetica.js';
import { ApoioRemessaController } from './apoio-remessa.controller.js';

const PERFIL = 'laboratorio-apoio';
const VAZIO = {
  unidades: [],
  locais: [],
  convenios: [],
  centrosCusto: [],
  locaisEstoque: [],
  contasBancarias: [],
  tiposAgenda: [],
  tiposProntuario: [],
};

function permissoesDa(login: string): readonly string[] {
  const conta = CONTAS_SINTETICAS[login];
  if (!conta) throw new Error(`conta ausente: ${login}`);
  const c = conta.concessoes;
  return calcularAutorizacao(
    {
      concessoes: {
        grupo: c?.grupo ?? null,
        opcoesGrupo: c?.opcoesGrupo ?? [],
        opcoesPapel: [],
        papeis: [],
        flags: [],
        conselho: c?.conselho ?? false,
      },
      escopos: VAZIO,
      restricaoVinculo: false,
      perfisConcedidos: (conta.perfisConcedidos ?? []).map((perfil) => ({
        perfil,
        inicio: new Date(0),
        fim: null,
      })),
      mapaPerfis: [],
    },
    Date.now(),
  ).permissoes;
}

const proto = ApoioRemessaController.prototype as unknown as Record<string, object>;
const meta = (chave: string, metodo: string): unknown => {
  const alvo = proto[metodo];
  if (!alvo) throw new Error(`rota ausente: ${metodo}`);
  return Reflect.getMetadata(chave, alvo);
};

describe('laboratório de apoio: permissões do pessoal do laboratório (C1-092)', () => {
  it('o perfil próprio está no catálogo e concede ler, remessa e de-para, nunca a conferência', () => {
    expect(PERFIS_COMPLEMENTARES as readonly string[]).toContain(PERFIL);
    for (const codigo of ['sadt.apoio.ler', 'sadt.apoio.remessa', 'sadt.apoio.configurar']) {
      const d = PERMISSOES_M34.find((p) => p.codigo === codigo);
      expect(d).toMatchObject({ concessaoPorPerfil: 'por-perfil' });
      expect(d?.perfis).toContain(PERFIL);
      for (const p of d?.perfis ?? []) expect(PERFIS_COMPLEMENTARES as readonly string[]).toContain(p);
    }
    const conferir = PERMISSOES_M34.find((p) => p.codigo === 'sadt.apoio.conferir');
    expect(conferir?.perfis ?? []).not.toContain(PERFIL);
    expect(conferir).toMatchObject({ exigeConselho: true });
  });

  it('as rotas de gravação da remessa e do de-para pedem a permissão própria, com a trilha no handler', () => {
    for (const m of ['abrir', 'agir', 'retirar']) {
      expect(meta(CHAVE_PERMISSAO, m)).toBe('sadt.apoio.remessa');
      expect(meta(CHAVE_AUDITADO_NO_HANDLER, m)).toBeTruthy();
    }
    expect(meta(CHAVE_PERMISSAO, 'etiquetas')).toBe('sadt.apoio.remessa');
    for (const m of ['deParaAnalito', 'deParaMaterial']) {
      expect(meta(CHAVE_PERMISSAO, m)).toBe('sadt.apoio.configurar');
      expect(meta(CHAVE_AUDITADO_NO_HANDLER, m)).toBeTruthy();
    }
  });

  it('o técnico do apoio, só com o perfil, lê, monta a remessa e mantém o de-para, sem conferir o resultado', () => {
    expect(CONTAS_SINTETICAS['SINT.LAB.APOIO']?.perfisConcedidos).toEqual([PERFIL]);
    const p = permissoesDa('SINT.LAB.APOIO');
    expect(p).toEqual(
      expect.arrayContaining(['sadt.apoio.ler', 'sadt.apoio.remessa', 'sadt.apoio.configurar']),
    );
    expect(p).not.toContain('sadt.apoio.conferir');
    expect(p).not.toContain('sadt.resultado.liberar');
  });

  it('o biomédico migrado (opção de interfaceamento da origem) ganha a remessa e o de-para pelo perfil', () => {
    const p = permissoesDa('SINT.BIOMEDICO');
    expect(p).toEqual(
      expect.arrayContaining(['sadt.apoio.ler', 'sadt.apoio.remessa', 'sadt.apoio.configurar']),
    );
  });

  it('o laboratório sem o perfil não monta remessa nem mexe no de-para', () => {
    const p = permissoesDa('SINT.LABORATORIO');
    expect(p).not.toContain('sadt.apoio.remessa');
    expect(p).not.toContain('sadt.apoio.configurar');
  });
});
