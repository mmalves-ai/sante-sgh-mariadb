<script setup lang="ts">
// Checklist de cirurgia segura (M46, etapa 2; ficha, seção 7; regras 1 e 2; operações cirurgia.confirmarItemChecklist e
// cirurgia.concluirMomentoChecklist), para o tablet do circulante. Sem cirurgia escolhida, as cirurgias do dia com a
// situação dos três momentos. Com a cirurgia: o cabeçalho do paciente (alergias em destaque), os três momentos (antes da
// indução, antes da incisão, antes de sair da sala) com cada item, a resposta, quem confirmou e a hora; o momento só
// conclui na ordem e com todos os itens respondidos (o servidor confere de novo). A incisão liberada (pausa concluída
// ou exceção) aparece em destaque; a exceção em urgência é do supervisor, com o motivo.
import {
  RESPOSTAS_CHECKLIST,
  type MomentoChecklistResposta,
  type MomentoChecklist,
  type ItemChecklistResposta,
} from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteOpcoes } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { usarContextoClinico } from '../../../casca/notificar/contexto-clinico.js';
import { novaChaveAnestesia } from '../api-anestesia.js';
import { gravarBloco, lerChecklist, lerCirurgiasChecklist } from '../api-bloco-seguro.js';
import CabecalhoAnestesia from '../componentes/CabecalhoAnestesia.vue';
import ErroBloco from '../componentes/ErroBloco.vue';
import './estilo-anestesia.css';

const props = defineProps<{ agenda: string }>();
const { t } = useI18n();
const router = useRouter();
const agenda = computed(() => Number(props.agenda) || null);

const data = ref('');
const lista = useQuery({
  queryKey: computed(() => ['bloco', 'checklist', 'cirurgias', data.value]),
  queryFn: () => lerCirurgiasChecklist(data.value || null),
  enabled: computed(() => !agenda.value),
});
const dados = useQuery({
  queryKey: computed(() => ['bloco', 'checklist', agenda.value]),
  queryFn: () => lerChecklist(agenda.value!),
  enabled: computed(() => !!agenda.value),
  refetchInterval: 20_000,
});
const tela = computed(() => dados.data.value);
const checklist = computed(() => tela.value?.checklist);
// M48 (etapa 2): o atendimento da cirurgia é o contexto do "Notificar incidente" (o rótulo é o que o cabeçalho mostra).
usarContextoClinico(() => {
  const c = tela.value?.contexto;
  return c && c.atendimento !== null
    ? {
        atendimento: c.atendimento,
        rotulo: c.nome ?? t('qualidade.sugestoes.atendimento', { n: c.atendimento }),
      }
    : null;
});

const agoraLocal = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const hora = (x: string | null | undefined) => (x ? x.replace('T', ' ').slice(11, 16) : '—');
const em = ref(agoraLocal());

/** As respostas na tela por momento e item (iniciadas pela vigente; o que mudou vai no "Confirmar"). */
const respostas = reactive<Record<string, { resposta: string; observacao: string }>>({});
const chaveItem = (m: MomentoChecklist, i: string) => `${m}:${i}`;
watch(
  checklist,
  (c) => {
    if (!c) return;
    for (const m of c.momentos)
      for (const i of m.itens)
        respostas[chaveItem(m.momento, i.codigo)] = {
          resposta: i.resposta ?? '',
          observacao: i.observacao ?? '',
        };
  },
  { immediate: true },
);

const opcoesDoItem = (i: ItemChecklistResposta) =>
  RESPOSTAS_CHECKLIST.filter((r) =>
    i.tipo === 'confirmacao' ? r.codigo !== 'na' : i.tipo === 'confirmacaoOuNa' ? true : r.codigo !== 'na',
  ).map((r) => ({ valor: r.codigo as string, rotulo: r.rotulo }));
const exigeObservacao = (i: ItemChecklistResposta, resposta: string) =>
  resposta !== '' && (i.observacaoSe === resposta || (i.tipo !== 'pergunta' && resposta === 'nao'));
const alterados = (m: MomentoChecklistResposta) =>
  m.itens.filter((i) => {
    const r = respostas[chaveItem(m.momento, i.codigo)];
    return (
      r && r.resposta !== '' && (r.resposta !== (i.resposta ?? '') || r.observacao !== (i.observacao ?? ''))
    );
  });

const podeConfirmar = computed(() => tela.value?.gravacao.operacoes['confirmar']?.pode === true);
const podeExcecao = computed(() => tela.value?.gravacao.operacoes['excecao']?.pode === true);
const erro = ref<unknown>(null);
const mensagem = ref('');
const enviando = ref(false);

async function enviar(url: string, corpo: Record<string, unknown>, rotulo: string): Promise<void> {
  erro.value = null;
  mensagem.value = '';
  enviando.value = true;
  try {
    const r = await gravarBloco(url, corpo, novaChaveAnestesia(rotulo));
    mensagem.value = r.mensagem;
  } catch (e) {
    erro.value = e;
  } finally {
    enviando.value = false;
    await dados.refetch();
  }
}

function confirmar(m: MomentoChecklistResposta): Promise<void> {
  const itens = alterados(m).map((i) => {
    const r = respostas[chaveItem(m.momento, i.codigo)]!;
    return { item: i.codigo, resposta: r.resposta, observacao: r.observacao.trim() || null };
  });
  return enviar(
    `/${agenda.value}/checklist/itens`,
    {
      agendamento: agenda.value,
      momento: m.momento,
      versaoVista: checklist.value!.versao,
      em: em.value,
      itens,
    },
    'checklist-itens',
  );
}

function concluir(m: MomentoChecklistResposta): Promise<void> {
  return enviar(
    `/${agenda.value}/checklist/momentos`,
    { agendamento: agenda.value, momento: m.momento, versaoVista: checklist.value!.versao, em: em.value },
    'checklist-momento',
  );
}

const excecao = reactive({ urgencia: false, motivo: '' });
function registrarExcecao(): Promise<void> {
  return enviar(
    `/${agenda.value}/checklist/excecao`,
    {
      agendamento: agenda.value,
      versaoVista: checklist.value!.versao,
      urgencia: true,
      motivo: excecao.motivo.trim(),
      em: em.value,
    },
    'checklist-excecao',
  );
}

const resumo = (c: { inducao: boolean; incisao: boolean; saida: boolean } | null) =>
  c
    ? t('blocoSeguro.quadro.momentos', {
        inducao: c.inducao ? t('blocoSeguro.quadro.sim') : t('blocoSeguro.quadro.nao'),
        incisao: c.incisao ? t('blocoSeguro.quadro.sim') : t('blocoSeguro.quadro.nao'),
        saida: c.saida ? t('blocoSeguro.quadro.sim') : t('blocoSeguro.quadro.nao'),
      })
    : t('blocoSeguro.escolha.semChecklist');
function abrir(a: number): void {
  void router.push({ name: 'bloco.checklist', params: { agenda: String(a) } });
}
</script>

<template>
  <section class="tela-anest" aria-labelledby="chk-titulo" data-testid="tela-checklist">
    <h1 id="chk-titulo">{{ t('blocoSeguro.checklist.titulo') }}</h1>
    <template v-if="!agenda">
      <div class="barra">
        <span class="campo">
          <label for="chk-data">{{ t('blocoSeguro.escolha.data') }}</label>
          <input id="chk-data" v-model="data" type="date" data-testid="chk-data" />
        </span>
      </div>
      <ErroBloco v-if="lista.isError.value" :erro="lista.error.value" />
      <p v-else-if="!lista.data.value" role="status">{{ t('blocoSeguro.carregando') }}</p>
      <p v-else-if="lista.data.value.linhas.length === 0">{{ t('blocoSeguro.escolha.semCirurgias') }}</p>
      <div v-else class="rolagem">
        <table class="grade">
          <caption class="secundario">
            {{
              t('blocoSeguro.escolha.legenda', { data: lista.data.value.data })
            }}
          </caption>
          <thead>
            <tr>
              <th scope="col">{{ t('blocoSeguro.escolha.sala') }}</th>
              <th scope="col">{{ t('blocoSeguro.escolha.horario') }}</th>
              <th scope="col">{{ t('blocoSeguro.escolha.paciente') }}</th>
              <th scope="col">{{ t('blocoSeguro.escolha.procedimento') }}</th>
              <th scope="col">{{ t('blocoSeguro.escolha.situacao') }}</th>
              <th scope="col">{{ t('blocoSeguro.escolha.acao') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="l in lista.data.value.linhas"
              :key="l.agendamento"
              :data-testid="`chk-cirurgia-${l.agendamento}`"
            >
              <td>{{ l.sala }}</td>
              <td>{{ l.inicio.slice(11, 16) }}</td>
              <td>{{ l.paciente }}</td>
              <td>{{ l.procedimento ?? '—' }}</td>
              <td>{{ resumo(l.checklist) }}</td>
              <td>
                <SanteBotao
                  variante="secundario"
                  :rotulo="t('blocoSeguro.escolha.abrir')"
                  :data-testid="`chk-abrir-${l.agendamento}`"
                  @acionar="abrir(l.agendamento)"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="lista.data.value.truncado" class="secundario">{{ t('blocoSeguro.escolha.truncado') }}</p>
      </div>
    </template>
    <template v-else>
      <ErroBloco v-if="dados.isError.value" :erro="dados.error.value" />
      <p v-else-if="!tela || !checklist" role="status">{{ t('blocoSeguro.carregando') }}</p>
      <template v-else>
        <CabecalhoAnestesia :contexto="tela.contexto" :exames="false" />
        <SanteAlerta
          v-if="!tela.gravacao.ligada"
          variante="aviso"
          :texto="tela.gravacao.motivo ?? t('blocoSeguro.emConsulta')"
          data-testid="chk-desligado"
        />
        <div class="barra" data-testid="chk-situacao">
          <SanteAlerta
            :variante="checklist.incisaoLiberada ? 'info' : 'aviso'"
            :texto="
              checklist.incisaoLiberada
                ? t('blocoSeguro.checklist.incisaoLiberada')
                : t('blocoSeguro.checklist.incisaoBloqueada')
            "
            data-testid="chk-incisao"
          />
          <p class="secundario">
            {{
              tela.trava.ligada
                ? t('blocoSeguro.checklist.travaLigada')
                : t('blocoSeguro.checklist.travaDesligada')
            }}
          </p>
        </div>
        <SanteAlerta
          v-if="checklist.alertas.length > 0"
          variante="alerta"
          :texto="`${t('blocoSeguro.checklist.alertas')}: ${checklist.alertas.join('; ')}`"
          data-testid="chk-alertas"
        />
        <p v-if="checklist.registroProntuario === null" class="secundario">
          {{ t('blocoSeguro.checklist.prontuarioAguarda') }}
        </p>
        <div class="barra">
          <span class="campo">
            <label for="chk-em">{{ t('blocoSeguro.horario') }}</label>
            <input id="chk-em" v-model="em" type="datetime-local" data-testid="chk-em" />
          </span>
          <SanteBotao
            variante="secundario"
            :rotulo="t('blocoSeguro.voltar')"
            @acionar="router.push({ name: 'bloco.checklist' })"
          />
        </div>
        <ErroBloco v-if="erro" :erro="erro" />
        <p v-if="mensagem" role="status" data-testid="chk-mensagem">{{ mensagem }}</p>
        <section
          v-for="m in checklist.momentos"
          :key="m.momento"
          class="cartao"
          :aria-labelledby="`chk-m-${m.momento}`"
          :data-testid="`chk-momento-${m.momento}`"
        >
          <h2 :id="`chk-m-${m.momento}`">{{ m.rotulo }}</h2>
          <p v-if="m.concluidoEm" class="secundario" :data-testid="`chk-concluido-${m.momento}`">
            {{ t('blocoSeguro.checklist.concluido', { hora: hora(m.concluidoEm), por: m.concluidoPor }) }}
          </p>
          <div v-for="i in m.itens" :key="i.codigo" class="item-chk" :data-testid="`chk-item-${i.codigo}`">
            <SanteOpcoes
              v-model="respostas[chaveItem(m.momento, i.codigo)]!.resposta"
              :legenda="i.rotulo"
              :opcoes="opcoesDoItem(i)"
              :nome="`chk-${m.momento}-${i.codigo}`"
            />
            <span
              v-if="exigeObservacao(i, respostas[chaveItem(m.momento, i.codigo)]!.resposta)"
              class="campo"
            >
              <label :for="`chk-obs-${i.codigo}`">{{ t('blocoSeguro.checklist.observacao') }}</label>
              <input
                :id="`chk-obs-${i.codigo}`"
                v-model="respostas[chaveItem(m.momento, i.codigo)]!.observacao"
                type="text"
                maxlength="255"
                :disabled="!!m.concluidoEm"
                :data-testid="`chk-obs-${i.codigo}`"
              />
            </span>
            <p v-if="i.confirmadoEm" class="secundario">
              {{
                t('blocoSeguro.checklist.confirmadoPor', { hora: hora(i.confirmadoEm), por: i.confirmadoPor })
              }}
            </p>
          </div>
          <p
            v-if="!m.concluidoEm && m.pendentes.length > 0"
            class="secundario"
            :data-testid="`chk-pendentes-${m.momento}`"
          >
            {{ t('blocoSeguro.checklist.pendentes', { itens: m.pendentes.length }) }}
          </p>
          <div v-if="!m.concluidoEm && podeConfirmar" class="barra">
            <SanteBotao
              variante="secundario"
              :rotulo="t('blocoSeguro.checklist.confirmar')"
              :desabilitado="enviando || alterados(m).length === 0"
              :data-testid="`chk-confirmar-${m.momento}`"
              @acionar="confirmar(m)"
            />
            <SanteBotao
              :rotulo="
                t('blocoSeguro.checklist.concluir', {
                  momento: t(`blocoSeguro.checklist.momentoCurto.${m.momento}`),
                })
              "
              :desabilitado="enviando || m.impedimento !== null || alterados(m).length > 0"
              :data-testid="`chk-concluir-${m.momento}`"
              @acionar="concluir(m)"
            />
          </div>
        </section>
        <section
          v-if="checklist.excecao || (!checklist.incisaoLiberada && podeExcecao)"
          class="cartao"
          aria-labelledby="chk-exc"
          data-testid="chk-excecao"
        >
          <h2 id="chk-exc">{{ t('blocoSeguro.checklist.excecao.titulo') }}</h2>
          <p v-if="checklist.excecao" data-testid="chk-excecao-registrada">
            {{
              t('blocoSeguro.checklist.excecao.registrada', {
                hora: hora(checklist.excecao.em),
                por: checklist.excecao.por,
                motivo: checklist.excecao.motivo,
              })
            }}
          </p>
          <template v-else-if="tela.carater === 2">
            <p class="secundario">{{ t('blocoSeguro.checklist.excecao.eletiva') }}</p>
          </template>
          <template v-else>
            <p class="secundario">{{ t('blocoSeguro.checklist.excecao.explicacao') }}</p>
            <label class="campo-marca">
              <input v-model="excecao.urgencia" type="checkbox" data-testid="chk-excecao-urgencia" />
              {{ t('blocoSeguro.checklist.excecao.urgencia') }}
            </label>
            <span class="campo">
              <label for="chk-exc-motivo">{{ t('blocoSeguro.checklist.excecao.motivo') }}</label>
              <textarea
                id="chk-exc-motivo"
                v-model="excecao.motivo"
                maxlength="400"
                rows="2"
                data-testid="chk-excecao-motivo"
              />
            </span>
            <SanteBotao
              variante="destrutivo"
              :confirmacao="t('blocoSeguro.checklist.excecao.confirmacao')"
              :rotulo="t('blocoSeguro.checklist.excecao.registrar')"
              :desabilitado="enviando || !excecao.urgencia || excecao.motivo.trim().length < 10"
              data-testid="chk-excecao-registrar"
              @acionar="registrarExcecao"
            />
          </template>
        </section>
      </template>
    </template>
  </section>
</template>

<style scoped>
.item-chk {
  border-top: 1px solid var(--sgh-borda);
  padding: var(--sgh-espaco-1) 0;
}
.campo-marca {
  display: flex;
  align-items: center;
  gap: var(--sgh-espaco-1);
  min-height: 2.75rem;
}
</style>
