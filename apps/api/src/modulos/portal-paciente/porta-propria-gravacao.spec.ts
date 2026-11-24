// Unidade da gravação própria do portal (portal-b): as recusas que não dependem do banco, sobre uma transação falsa
// (a integração com o MariaDB está em porta-propria-gravacao.int.spec.ts).
import type { TxOperacao } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import {
  DOMINIOS_CONSENTIMENTO_PROPRIO,
  erroDeDominio,
  gravadorGravacaoPropria,
  SITUACAO_CONSENTIMENTO_DO_BANCO,
  SITUACAO_PEDIDO_DO_BANCO,
  SIGNATARIO_DO_BANCO,
  TABELAS_GRAVACAO_PORTAL,
} from './porta-propria-gravacao.js';
import { ErroPedido, ErroPortal } from './tipos.js';

function txFalsa(linhas: Record<string, unknown>[] = []) {
  const chamadas: string[] = [];
  const tx = {
    contexto: { usuario: null },
    uma: async () => null,
    consultar: async () => [],
    consultarParaAtualizar: async () => linhas,
    incluir: async (t: string) => (chamadas.push(`incluir ${t}`), 1),
    alterar: async (t: string) => (chamadas.push(`alterar ${t}`), 2),
    executar: async () => 1,
  } as unknown as TxOperacao;
  return { tx, chamadas };
}

describe('gravação própria do portal do paciente (unidade)', () => {
  it('declara as tabelas que grava e os domínios do consentimento com valor no modelo', () => {
    expect(TABELAS_GRAVACAO_PORTAL).toContain('conta_portal_paciente');
    expect(TABELAS_GRAVACAO_PORTAL).toContain('ato_copia_prontuario');
    for (const s of DOMINIOS_CONSENTIMENTO_PROPRIO.situacoes)
      expect(SITUACAO_CONSENTIMENTO_DO_BANCO[s.id]).toBeDefined();
    for (const s of DOMINIOS_CONSENTIMENTO_PROPRIO.signatarios)
      expect(SIGNATARIO_DO_BANCO[s.id]).toBeDefined();
    expect(SITUACAO_PEDIDO_DO_BANCO['em_analise']).toBe('identidade-verificada');
  });

  it('erro de domínio passa; o resto fica com o executor', () => {
    expect(erroDeDominio(new ErroPortal('situacao', 'x'))).toBeInstanceOf(ErroPortal);
    expect(erroDeDominio(new ErroPedido('transicao', 'x'))).toBeInstanceOf(ErroPedido);
    expect(erroDeDominio(new Error('x'))).toBeNull();
  });

  it('conta inexistente ou em outra versão: versao-desatualizada, nada gravado', async () => {
    const { tx, chamadas } = txFalsa([]);
    const g = gravadorGravacaoPropria(tx, 1, { tabela: 't', id: null });
    await expect(g.trocarSenha(5, 1, 'r')).rejects.toMatchObject({ codigo: 'versao-desatualizada' });
    const v = txFalsa([{ id: 5, versao: 3, situacao: 'ativa' }]);
    await expect(
      gravadorGravacaoPropria(v.tx, 1, { tabela: 't', id: null }).bloquear(5, 2, { motivo: 'm', por: 'p' }),
    ).rejects.toMatchObject({ codigo: 'versao-desatualizada' });
    expect([...chamadas, ...v.chamadas]).toEqual([]);
  });

  it('entrada e erro do convite em conta fora da situação: nada gravado', async () => {
    const { tx, chamadas } = txFalsa([{ id: 5, versao: 1, situacao: 'encerrada' }]);
    const g = gravadorGravacaoPropria(tx, 1, { tabela: 't', id: null });
    await g.registrarEntrada(5, { acertou: true, tentativas: 0, bloqueadoAte: null });
    await g.registrarErroConvite(5);
    expect(chamadas).toEqual([]);
  });

  it('segregação: quem pede o vínculo não o aprova; consentimento com domínio desconhecido recusa', async () => {
    const { tx } = txFalsa();
    const g = gravadorGravacaoPropria(tx, 1, { tabela: 't', id: null });
    await expect(
      g.pedirVinculo({
        conta: 1,
        titular: 2,
        prontuarioTitular: 3,
        tipo: 'tutor',
        prova: 'p',
        arquivoChave: null,
        arquivoHash: null,
        validade: null,
        escopos: [],
        canal: 'balcao',
        por: 'a',
        decididoPor: 'a',
      }),
    ).rejects.toMatchObject({ problema: { codigo: 'segregacao-decisao' } });
    await expect(
      g.registrarConsentimento({
        idPaciente: 1,
        pront: 1,
        finalidade: 'f',
        versao: '1',
        situacao: 99,
        signatario: 1,
        usuario: 'u',
        conta: 1,
        vinculo: null,
      }),
    ).rejects.toMatchObject({ problema: { codigo: 'situacao-invalida' } });
  });
});
