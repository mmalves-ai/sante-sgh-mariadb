<script setup lang="ts">
// Migração gradual: treinamento (M37, ficha seção 7; regras 3, 4 e 5): as trilhas por papel e por onda com a versão, a
// carga de referência, as tarefas (guia de uma página e roteiro de vídeo gerados das jornadas; versão anterior marcada
// desatualizada) e o exercício prático; as turmas e as conclusões por pessoa. O instrutor e o chave-usuário publicam a
// versão da trilha e registram a conclusão da turma (ninguém a própria). O ambiente de treino só abre com o método de
// mascaramento registrado pelo dono.
import type { GuiaTreino, PapelTreinamento, TurnoTreino } from '@sgh/contratos';
import { PAPEIS_TREINAMENTO, TURNOS_TREINO } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import {
  estornarConclusao,
  lerGuia,
  lerTreino,
  publicarTrilha,
  registrarConclusao,
  retirarVersaoTrilha,
} from '../api.js';
import AcaoCicloDialogo from '../componentes/AcaoCicloDialogo.vue';
import AbasMigracao from '../componentes/AbasMigracao.vue';

const { t } = useI18n();
const { permissoes } = usarSessao();
const cliente = useQueryClient();
const consulta = useQuery({ queryKey: ['coexistencia', 'treino'], queryFn: lerTreino });
const pode = computed(() => permissoes.value.has('config.coexistenciaTreino.registrar'));
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const exercicio = reactive<Record<string, string>>({});
const conclusao = reactive({
  papel: 'recepcao' as PapelTreinamento,
  onda: '1',
  turma: '',
  turno: 'nao-informado' as TurnoTreino | 'nao-informado',
  concluidoEm: new Date().toISOString().slice(0, 10),
  resultado: 'aprovado' as 'aprovado' | 'refazer',
  logins: '',
});
const opcoesPapel = PAPEIS_TREINAMENTO.map((p) => ({ valor: p, rotulo: t(`coexistencia.papeis.${p}`) }));
const opcoesOnda = [0, 1, 2, 3, 4, 5].map((n) => ({ valor: String(n), rotulo: String(n) }));
// M43, regra 6: o turno da turma (plantonistas, noite e fim de semana treinam no turno deles).
const opcoesTurno = (['nao-informado', ...TURNOS_TREINO] as const).map((x) => ({
  valor: x,
  rotulo: t(`coexistencia.treino.turnos.${x}`),
}));
const opcoesResultado = (['aprovado', 'refazer'] as const).map((r) => ({
  valor: r,
  rotulo: t(`coexistencia.resultados.${r}`),
}));

// O guia (ou roteiro de vídeo) aberto na própria tela, com a marca de desatualizado da tarefa.
const guiaAberto = ref<(GuiaTreino & { desatualizada: boolean }) | null>(null);
const erroGuia = ref<unknown>(null);
async function abrirGuia(endereco: string, desatualizada: boolean): Promise<void> {
  erroGuia.value = null;
  try {
    guiaAberto.value = { ...(await lerGuia(endereco)), desatualizada };
  } catch (e) {
    guiaAberto.value = null;
    erroGuia.value = e;
  }
}

async function publicar(papel: string, onda: number): Promise<void> {
  erro.value = null;
  try {
    const r = await publicarTrilha(papel, onda, exercicio[`${papel}-${onda}`] ?? '');
    mensagem.value = t('coexistencia.treino.publicada', { versao: r.versao });
    await cliente.invalidateQueries({ queryKey: ['coexistencia'] });
  } catch (e) {
    erro.value = e;
  }
}

// W0-09: retirar a versão da trilha (exclusão recusada com a contagem quando há turmas ou conclusões, com a oferta de
// inativar) e estornar a conclusão (sai da contagem; o estorno fica com o motivo). Sempre com motivo, em diálogo.
type AcaoCiclo =
  | { tipo: 'retirar'; papel: string; onda: number; versao: number; nome: string }
  | { tipo: 'estornar'; id: string; login: string };
const acao = ref<AcaoCiclo | null>(null);
const dialogo = ref(false);
function abrirAcao(a: AcaoCiclo): void {
  acao.value = a;
  dialogo.value = true;
}
const tituloAcao = computed(() =>
  acao.value?.tipo === 'retirar'
    ? t('coexistencia.ciclo.retirarTitulo', { trilha: acao.value.nome, versao: acao.value.versao })
    : acao.value
      ? t('coexistencia.ciclo.estornarTitulo', { login: acao.value.login })
      : '',
);
function executarAcao(motivo: string, _senha: string, inativar: boolean): Promise<unknown> {
  const a = acao.value;
  if (!a) return Promise.resolve(null);
  return a.tipo === 'retirar'
    ? retirarVersaoTrilha(a.papel, a.onda, a.versao, motivo, inativar)
    : estornarConclusao(a.id, motivo);
}
async function acaoFeita(inativou: boolean): Promise<void> {
  const a = acao.value;
  mensagem.value =
    a?.tipo === 'retirar'
      ? t(inativou ? 'coexistencia.ciclo.inativada' : 'coexistencia.ciclo.excluida', { versao: a.versao })
      : t('coexistencia.ciclo.estornada');
  await cliente.invalidateQueries({ queryKey: ['coexistencia'] });
}

async function concluir(): Promise<void> {
  erro.value = null;
  try {
    const r = await registrarConclusao({
      papel: conclusao.papel,
      onda: Number(conclusao.onda),
      turma: conclusao.turma,
      ...(conclusao.turno === 'nao-informado' ? {} : { turno: conclusao.turno }),
      concluidoEm: conclusao.concluidoEm,
      resultado: conclusao.resultado,
      logins: conclusao.logins
        .split(/[,;\s]+/)
        .map((x) => x.trim())
        .filter(Boolean),
    });
    mensagem.value = t('coexistencia.treino.registradas', {
      n: r.registradas,
      faltam: r.naoEncontrados.join(', ') || '—',
    });
    await cliente.invalidateQueries({ queryKey: ['coexistencia'] });
  } catch (e) {
    erro.value = e;
  }
}
</script>

<template>
  <section class="tela-agenda" aria-labelledby="titulo-treino" data-testid="tela-migracao-treino">
    <h1 id="titulo-treino">{{ t('coexistencia.treino.titulo') }}</h1>
    <AbasMigracao atual="treinamento" />
    <p>{{ t('coexistencia.treino.texto') }}</p>
    <MensagemErro v-if="consulta.error.value" :erro="consulta.error.value" />
    <p v-else-if="!consulta.data.value" role="status">{{ t('coexistencia.carregando') }}</p>
    <template v-else>
      <SanteAlerta
        :texto="consulta.data.value.ambienteTreino.motivo"
        :variante="consulta.data.value.ambienteTreino.metodoRegistrado ? 'info' : 'aviso'"
        data-testid="ambiente-treino"
      />
      <table class="tabela" data-testid="tabela-trilhas">
        <caption>
          {{
            t('coexistencia.treino.trilhas')
          }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ t('coexistencia.treino.trilha') }}</th>
            <th scope="col">{{ t('coexistencia.treino.versao') }}</th>
            <th scope="col">{{ t('coexistencia.treino.carga') }}</th>
            <th scope="col">{{ t('coexistencia.treino.tarefas') }}</th>
            <th scope="col">{{ t('coexistencia.treino.concluidas') }}</th>
            <th v-if="pode" scope="col">{{ t('coexistencia.treino.publicar') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="tr in consulta.data.value.trilhas"
            :key="`${tr.papel}-${tr.onda}`"
            :data-testid="`trilha-${tr.papel}-${tr.onda}`"
          >
            <th scope="row">{{ tr.nome }}</th>
            <td data-testid="versao">
              {{ tr.publicada ? tr.versao : t('coexistencia.treino.naoPublicada') }}
              <details v-if="tr.versoes.length > 0" :data-testid="`versoes-${tr.papel}-${tr.onda}`">
                <summary>{{ t('coexistencia.ciclo.versoes', { n: tr.versoes.length }) }}</summary>
                <ul>
                  <li
                    v-for="v in tr.versoes"
                    :key="v.versao"
                    :data-testid="`versao-${tr.papel}-${tr.onda}-${v.versao}`"
                  >
                    {{
                      t('coexistencia.ciclo.versao', {
                        versao: v.versao,
                        situacao: t(`coexistencia.ciclo.situacoesVersao.${v.situacao}`),
                        n: v.conclusoes,
                      })
                    }}
                    <SanteBotao
                      v-if="pode && v.situacao !== 'retirada'"
                      :rotulo="t('coexistencia.ciclo.retirar')"
                      variante="texto"
                      :data-testid="`retirar-${tr.papel}-${tr.onda}-${v.versao}`"
                      @acionar="
                        abrirAcao({
                          tipo: 'retirar',
                          papel: tr.papel,
                          onda: tr.onda,
                          versao: v.versao,
                          nome: tr.nome,
                        })
                      "
                    />
                  </li>
                </ul>
              </details>
            </td>
            <td>{{ tr.carga }}</td>
            <td>
              <ul>
                <li v-for="x in tr.tarefas" :key="x.id" :data-testid="`tarefa-${tr.papel}-${x.id}`">
                  {{ x.titulo
                  }}<span v-if="x.desatualizada"> ({{ t('coexistencia.treino.desatualizada') }})</span>
                  <SanteBotao
                    :rotulo="t('coexistencia.treino.abrirGuia')"
                    variante="texto"
                    :data-testid="`guia-${tr.papel}-${x.id}`"
                    @acionar="abrirGuia(x.guia, x.desatualizada)"
                  />
                  <SanteBotao
                    :rotulo="t('coexistencia.treino.abrirVideo')"
                    variante="texto"
                    :data-testid="`video-${tr.papel}-${x.id}`"
                    @acionar="abrirGuia(x.video, x.desatualizada)"
                  />
                </li>
              </ul>
            </td>
            <td>{{ tr.concluidas }}</td>
            <td v-if="pode">
              <form @submit.prevent="publicar(tr.papel, tr.onda)">
                <label :for="`exercicio-${tr.papel}-${tr.onda}`">{{
                  t('coexistencia.treino.exercicio')
                }}</label>
                <textarea
                  :id="`exercicio-${tr.papel}-${tr.onda}`"
                  v-model="exercicio[`${tr.papel}-${tr.onda}`]"
                  rows="2"
                  maxlength="400"
                  :data-testid="`exercicio-${tr.papel}-${tr.onda}`"
                />
                <SanteBotao
                  :rotulo="t('coexistencia.treino.publicar')"
                  variante="secundario"
                  tipo="submit"
                  :data-testid="`publicar-${tr.papel}-${tr.onda}`"
                />
              </form>
            </td>
          </tr>
        </tbody>
      </table>
      <MensagemErro v-if="erroGuia" :erro="erroGuia" />
      <section v-if="guiaAberto" class="guia-treino" aria-labelledby="titulo-guia" data-testid="guia-aberto">
        <h2 id="titulo-guia">
          {{
            t(guiaAberto.tipo === 'guia' ? 'coexistencia.treino.guiaDe' : 'coexistencia.treino.videoDe', {
              titulo: guiaAberto.titulo,
            })
          }}
        </h2>
        <SanteAlerta
          v-if="guiaAberto.desatualizada"
          :texto="t('coexistencia.treino.guiaDesatualizado')"
          variante="aviso"
          data-testid="guia-desatualizado"
        />
        <pre class="guia-texto" data-testid="guia-texto">{{ guiaAberto.texto }}</pre>
        <SanteBotao
          :rotulo="t('coexistencia.treino.fecharGuia')"
          variante="texto"
          data-testid="guia-fechar"
          @acionar="guiaAberto = null"
        />
      </section>

      <section v-if="pode" aria-labelledby="titulo-conclusao">
        <h2 id="titulo-conclusao">{{ t('coexistencia.treino.registrar') }}</h2>
        <form class="filtros" data-testid="form-conclusao" @submit.prevent="concluir">
          <SanteSelecao
            id="conclusao-papel"
            v-model="conclusao.papel"
            :rotulo="t('coexistencia.pessoas.papel')"
            :opcoes="opcoesPapel"
            data-testid="conclusao-papel"
          />
          <SanteSelecao
            id="conclusao-onda"
            v-model="conclusao.onda"
            :rotulo="t('coexistencia.onda')"
            :opcoes="opcoesOnda"
            data-testid="conclusao-onda"
          />
          <SanteCampoTexto
            v-model="conclusao.turma"
            :rotulo="t('coexistencia.treino.turma')"
            :max-bytes="40"
            obrigatorio
            data-testid="conclusao-turma"
          />
          <SanteSelecao
            id="conclusao-turno"
            v-model="conclusao.turno"
            :rotulo="t('coexistencia.treino.turno')"
            :opcoes="opcoesTurno"
            data-testid="conclusao-turno"
          />
          <div class="campo">
            <label for="conclusao-data">{{ t('coexistencia.treino.data') }}</label>
            <input
              id="conclusao-data"
              v-model="conclusao.concluidoEm"
              type="date"
              required
              data-testid="conclusao-data"
            />
          </div>
          <SanteSelecao
            id="conclusao-resultado"
            v-model="conclusao.resultado"
            :rotulo="t('coexistencia.treino.resultado')"
            :opcoes="opcoesResultado"
            data-testid="conclusao-resultado"
          />
          <div class="campo">
            <label for="conclusao-logins">{{ t('coexistencia.treino.logins') }}</label>
            <textarea
              id="conclusao-logins"
              v-model="conclusao.logins"
              rows="3"
              required
              data-testid="conclusao-logins"
            />
          </div>
          <SanteBotao
            :rotulo="t('coexistencia.treino.registrar')"
            variante="primario"
            tipo="submit"
            data-testid="conclusao-registrar"
          />
        </form>
      </section>
      <SanteAlerta v-if="mensagem" :texto="mensagem" variante="info" anunciar data-testid="mensagem-treino" />
      <MensagemErro v-if="erro" :erro="erro" />

      <section aria-labelledby="titulo-turmas">
        <h2 id="titulo-turmas">{{ t('coexistencia.treino.turmas') }}</h2>
        <p v-if="consulta.data.value.turmas.length === 0">{{ t('coexistencia.nenhum') }}</p>
        <table v-else class="tabela" data-testid="tabela-turmas">
          <caption>
            {{
              t('coexistencia.treino.turmas')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('coexistencia.treino.turma') }}</th>
              <th scope="col">{{ t('coexistencia.pessoas.papel') }}</th>
              <th scope="col">{{ t('coexistencia.onda') }}</th>
              <th scope="col">{{ t('coexistencia.setores.pessoas') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="x in consulta.data.value.turmas" :key="`${x.turma}-${x.papel}-${x.onda}`">
              <th scope="row">{{ x.turma }}</th>
              <td>{{ t(`coexistencia.papeis.${x.papel}`) }}</td>
              <td>{{ x.onda }}</td>
              <td>{{ x.pessoas }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section aria-labelledby="titulo-por-turno">
        <h2 id="titulo-por-turno">{{ t('coexistencia.treino.porTurno') }}</h2>
        <p>{{ t('coexistencia.treino.porTurnoExplicacao') }}</p>
        <table class="tabela" data-testid="tabela-por-turno">
          <caption>
            {{
              t('coexistencia.treino.porTurno')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('coexistencia.treino.turno') }}</th>
              <th scope="col">{{ t('coexistencia.setores.pessoas') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="x in consulta.data.value.porTurno"
              :key="x.turno"
              :data-testid="`por-turno-${x.turno}`"
            >
              <th scope="row">{{ t(`coexistencia.treino.turnos.${x.turno}`) }}</th>
              <td>{{ x.pessoas }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section aria-labelledby="titulo-conclusoes">
        <h2 id="titulo-conclusoes">{{ t('coexistencia.ciclo.conclusoes') }}</h2>
        <p v-if="consulta.data.value.conclusoes.length === 0">{{ t('coexistencia.nenhum') }}</p>
        <table v-else class="tabela" data-testid="tabela-conclusoes">
          <caption>
            {{
              t('coexistencia.ciclo.conclusoes')
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('coexistencia.ciclo.login') }}</th>
              <th scope="col">{{ t('coexistencia.pessoas.papel') }}</th>
              <th scope="col">{{ t('coexistencia.onda') }}</th>
              <th scope="col">{{ t('coexistencia.treino.turma') }}</th>
              <th scope="col">{{ t('coexistencia.treino.data') }}</th>
              <th scope="col">{{ t('coexistencia.ciclo.resultado') }}</th>
              <th v-if="pode" scope="col">{{ t('coexistencia.ciclo.acoes') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in consulta.data.value.conclusoes" :key="c.id" :data-testid="`conclusao-${c.id}`">
              <th scope="row">{{ c.login }}</th>
              <td>{{ t(`coexistencia.papeis.${c.papel}`) }}</td>
              <td>{{ c.onda }}</td>
              <td>{{ c.turma }}</td>
              <td>{{ c.concluidoEm }}</td>
              <td>{{ t(`coexistencia.resultados.${c.resultado}`) }}</td>
              <td v-if="pode">
                <SanteBotao
                  :rotulo="t('coexistencia.ciclo.estornar')"
                  variante="texto"
                  :data-testid="`estornar-${c.id}`"
                  @acionar="abrirAcao({ tipo: 'estornar', id: c.id, login: c.login })"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </section>
      <AcaoCicloDialogo
        v-model:visivel="dialogo"
        :titulo="tituloAcao"
        :texto="
          acao?.tipo === 'retirar'
            ? t('coexistencia.ciclo.retirarTexto')
            : t('coexistencia.ciclo.estornarTexto')
        "
        :rotulo="
          acao?.tipo === 'retirar' ? t('coexistencia.ciclo.retirar') : t('coexistencia.ciclo.estornar')
        "
        :oferta="acao?.tipo === 'retirar' ? t('coexistencia.ciclo.inativar') : ''"
        :executar="executarAcao"
        @feito="acaoFeita"
      />
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.guia-texto {
  white-space: pre-wrap;
  font-family: inherit;
  max-height: 32rem;
  overflow: auto;
}
</style>
