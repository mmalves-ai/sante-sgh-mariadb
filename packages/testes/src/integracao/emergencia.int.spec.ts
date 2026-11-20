// Quebra de vidro na cópia (ficha do M06, regra 8; charset da justificativa, seção 10): a abertura e a
// SGH_TRILHA na mesma transação, a vigência lida de volta, a revisão como linha nova (só inclusão), a CHECK
// que recusa abertura sem justificativa, e a justificativa com o corpus CP1252 lida igual (sem U+FFFD).
// O paciente é conferido em RICADPAC (ID inexistente recusado; prontuário, tipo e OTMU do cadastro): o teste
// cadastra um paciente sintético pela operação do M04 na mesma transação. Usuário e paciente sintéticos;
// tudo desfeito.
import { resolve } from 'node:path';
import { CORPUS_CP1252, CORPUS_CP1252_RECUSADOS } from '@sgh/contratos';
import {
  carregarDominiosVistos,
  ErroPacienteInexistente,
  gravarAberturaEmergencia,
  gravarRevisaoEmergencia,
  gravarTrilha,
  lerEmergenciaVigente,
  operacao,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cepCompleto,
  cpfLivre,
  loginLivre,
  pacienteSintetico,
  papelSintetico,
  usuarioSintetico,
} from '../massa/sintetica.js';
import {
  type Ambiente,
  ctx,
  ctxOperacao,
  PODE_ESCREVER,
  prepararAmbiente,
  raiz,
} from './escrita.spec-util.js';

/** ID fora do cadastro (recusado). */
const PACIENTE_INEXISTENTE = 999_000_001;
const cadastrar = operacao('cadastro.cadastrarPaciente');
const criarUsuario = operacao('acesso.criarUsuarioIntegracao');

describe.skipIf(!PODE_ESCREVER)('quebra de vidro (M06, regra 8)', () => {
  let a: Ambiente;
  beforeAll(async () => {
    a = await prepararAmbiente();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('abertura e trilha na mesma transação; vigente; revisão como linha nova; CP1252 lido igual', async () => {
    // Corpus CP1252 aceito (os textos com caractere fora do CP1252 são recusados antes, pelo contrato).
    const texto = CORPUS_CP1252.filter((t) => !CORPUS_CP1252_RECUSADOS.includes(t))
      .join(' | ')
      .slice(0, 500);
    const r = await a.nucleo.desfazendoNaCopia(ctx(a), async (e) => {
      const login = (await loginLivre(e, Date.now() % 1_000_000_000)).toUpperCase();
      await a.executor.executar(
        criarUsuario,
        a.cod,
        usuarioSintetico('usuario-tecnico', login),
        ctxOperacao(a, login),
        { escritor: e },
      );
      await papelSintetico(e, login);
      const cpf = await cpfLivre(e, Date.now() % 90_000_000);
      const tipos = carregarDominiosVistos(resolve(raiz, 'packages/legado/src')).vistos('RICADPAC', 'TPLGR');
      const cep = await cepCompleto(e, tipos ?? new Set<string>());
      const cad = await a.executor.executar(
        cadastrar,
        a.cod,
        pacienteSintetico('minimo', cpf, cep),
        ctxOperacao(a, login),
        { escritor: e },
      );
      const PACIENTE_SINTETICO = Number(cad.resultado['idPaciente']);
      const base = {
        rede: a.nucleo.rede,
        hospital: a.cod,
        idUsuario: 0,
        login: 'SGH.SINT.MEDICO',
        atendimento: null,
        motivo: 'intercorrencia-outro-setor',
        justificativa: texto,
        minutos: 60,
      };
      let inexistente = 'aceito';
      await gravarAberturaEmergencia(e, { ...base, idPaciente: PACIENTE_INEXISTENTE }).catch((x: unknown) => {
        inexistente = x instanceof ErroPacienteInexistente ? 'recusado' : 'outro erro';
      });
      const ab = await gravarAberturaEmergencia(e, {
        rede: a.nucleo.rede,
        hospital: a.cod,
        idUsuario: 0,
        login: 'SGH.SINT.MEDICO',
        idPaciente: PACIENTE_SINTETICO,
        atendimento: null,
        motivo: 'intercorrencia-outro-setor',
        justificativa: texto,
        minutos: 60,
      });
      const t = await gravarTrilha(e, {
        rede: a.nucleo.rede,
        hospital: a.cod,
        usuario: 'SGH.SINT.MEDICO',
        evento: 'acesso.emergencia.aberta',
        recurso: 'acesso.emergencia',
        operacao: 'acesso.abrirEmergencia',
        tabelaAlvo: 'SGH_ACESSO_EMERGENCIA',
        idAlvo: ab.id,
        chaveNaturalAlvo: null,
        resultado: 'sucesso',
        estacao: 'SGH-TESTE:sintetico',
        correlacao: 'int-m06',
        idPaciente: PACIENTE_SINTETICO,
      });
      const vigente = await lerEmergenciaVigente(e, a.cod, 'SGH.SINT.MEDICO', PACIENTE_SINTETICO);
      const [lida] = await e.consultar(
        `SELECT JUSTIFICATIVA J, IIF(em.PRONTUARIO = p.PRONT AND em.TIPOPAC = p.TIPOPAC AND em.OTMU = p.OTMU, 1, 0) C
           FROM SGH_ACESSO_EMERGENCIA em JOIN RICADPAC p ON p.ID = em.ID_RICADPAC WHERE em.ID = CAST(? AS BIGINT)`,
        [ab.id],
        {
          teto: 1,
        },
      );
      const rev = await gravarRevisaoEmergencia(e, {
        rede: a.nucleo.rede,
        hospital: a.cod,
        idEmergencia: ab.id,
        idUsuario: 0,
        login: 'SGH.SINT.AUDITOR',
        classificacao: 'justificado',
      });
      let semJustificativa = 'aceito';
      try {
        await e.executar(
          `INSERT INTO SGH_ACESSO_EMERGENCIA (ID, REGISTRO, REDE, HOSPITAL, ID_TBUSERS, LOGIN, ID_RICADPAC, MOTIVO, INICIO, FIM)
           VALUES (NEXT VALUE FOR SGH_GEN_ACESSO_EMERGENCIA, 'abertura', ?, ?, 0, 'X', 1, 'outro', CURRENT_TIMESTAMP, DATEADD(1 HOUR TO CURRENT_TIMESTAMP))`,
          [a.nucleo.rede, a.cod],
        );
      } catch (x) {
        semJustificativa = /SGH_CK_ACESSO_EMERGENCIA/.test(String(x)) ? 'recusado' : 'outro erro';
      }
      const [trilha] = await e.consultar(
        'SELECT EVENTO, ID_ALVO, CAST(ID_RICADPAC AS VARCHAR(20)) P FROM SGH_TRILHA WHERE ID = CAST(? AS BIGINT)',
        [t.id],
        { teto: 1 },
      );
      return {
        paciente: PACIENTE_SINTETICO,
        inexistente,
        doCadastro: Number(lida?.['C']),
        vigente: vigente?.id === ab.id,
        lida: String(lida?.['J'] ?? ''),
        rev,
        semJustificativa,
        trilha,
      };
    });
    expect(r.inexistente).toBe('recusado');
    expect(r.doCadastro).toBe(1);
    expect(r.vigente).toBe(true);
    expect(r.lida).toBe(texto);
    expect(r.lida).not.toContain('�');
    expect(r.rev).toMatch(/^\d+$/);
    expect(r.semJustificativa).toBe('recusado');
    expect(r.trilha).toMatchObject({ EVENTO: 'acesso.emergencia.aberta', P: String(r.paciente) });
  });
});
