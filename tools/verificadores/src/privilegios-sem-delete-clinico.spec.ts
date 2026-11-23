// SBIS-26 (parte estática, roda na esteira): o alcance gerado, o script versionado dos papéis por módulo e o anexo do
// papel da conta da aplicação não concedem DELETE em tabela clínica. A recusa pelo servidor, com conta real e
// SET DEFAULT ROLE pelo núcleo, fica em privilegios-servidor.int.spec.ts.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deleteClinicoProibido } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { caminhoScript, concessoesDoScript, gerarArtefatos, RAIZ } from './privilegios.ts';

const TABELAS_ALVO = ['registro_assistencial', 'prescricao'] as const;
const GRANT_ANEXO = /^GRANT ([A-Z, ]+) ON ([a-z][a-z0-9_]*) TO papel_aplicacao;$/;

describe('privilégios gerados: nenhum DELETE em tabela clínica (SBIS-26)', () => {
  it('o alcance gerado e o script versionado não concedem DELETE clínico a papel nenhum', () => {
    const a = gerarArtefatos();
    expect(a.alcances.length).toBeGreaterThan(10);
    const doAlcance = a.alcances.flatMap((x) =>
      Object.entries(x.objetos)
        .filter(([t, acoes]) => acoes.includes('DELETE') && deleteClinicoProibido(t))
        .map(([t]) => `${x.modulo}:${t}`),
    );
    expect(doAlcance).toEqual([]);
    const script = concessoesDoScript(readFileSync(resolve(RAIZ, caminhoScript('aplicar')), 'utf8'));
    // O parser leu o script inteiro: toda linha GRANT casou.
    const linhasGrant = readFileSync(resolve(RAIZ, caminhoScript('aplicar')), 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('GRANT ')).length;
    expect(script.length).toBe(linhasGrant);
    expect(script.filter((c) => c.acoes.includes('DELETE') && deleteClinicoProibido(c.tabela))).toEqual([]);
    // O script versionado é o que o gerador produz hoje.
    expect(readFileSync(resolve(RAIZ, caminhoScript('aplicar')), 'utf8')).toBe(a.aplicar);
    // Os alvos do teste no servidor são clínicos de fato.
    for (const t of TABELAS_ALVO) expect(deleteClinicoProibido(t), t).toBe(true);
  });

  it('o anexo do papel da conta da aplicação não concede DELETE clínico e só inclui na trilha e no fecho', () => {
    const texto = readFileSync(resolve(RAIZ, 'docs/implantacao/anexos/privilegios-papel.sql'), 'utf8');
    const grants = texto
      .split('\n')
      .map((l) => GRANT_ANEXO.exec(l.trim()))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => ({ acoes: m[1]!.split(',').map((a) => a.trim()), tabela: m[2]! }));
    expect(grants.length).toBeGreaterThan(1000);
    // Conflito conhecido e pendente: o NIR apaga fisicamente a solicitação e a reserva de leito (tx.excluir em
    // apps/api/src/modulos/adt/nir-porta-propria.ts). Qualquer outra tabela clínica com DELETE no anexo falha aqui.
    expect(
      grants
        .filter((g) => g.acoes.includes('DELETE') && deleteClinicoProibido(g.tabela))
        .map((g) => g.tabela),
    ).toEqual(['pedido_leito', 'reserva_leito']);
    for (const t of TABELAS_ALVO)
      expect(grants.find((g) => g.tabela === t)?.acoes, t).not.toContain('DELETE');
    for (const t of ['trilha_auditoria', 'trilha_auditoria_fecho', 'trilha_encadeamento_inicio'])
      expect(grants.find((g) => g.tabela === t)?.acoes, t).toEqual(['SELECT', 'INSERT']);
  });
});
