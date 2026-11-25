<script setup lang="ts">
// Documentos obrigatórios antes da cirurgia (C1-128, 04-CC linha 104; Cirurgia Segura da OMS, PNSP e CFM): na própria
// cirurgia, o que falta para confirmar e para começar, documento a documento com o estado na data da cirurgia
// (pendente, apresentado, vencido, dispensado, recusado). Registrar é um passo na linha do documento: a data de hoje
// já vem, o digitalizado do paciente se liga pelo combo e a regra do domínio valida na hora (o consentimento e a
// avaliação pré-anestésica só se dispensam na urgência). O histórico fica visível; nada é apagado.
import {
  conferirDocumentosCirurgia,
  conferirRegistroDocumento,
  type SituacaoRegistroDocumento,
} from '@sgh/dominio-cirurgia';
import { SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import { lerDocumentosDaCirurgia, registrarDocumentoDaCirurgia } from '../api-documentos-cirurgia.js';
import ErroCirurgia from './ErroCirurgia.vue';

const props = defineProps<{ agendamento: number }>();
const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Documentos obrigatórios',
      nenhum: 'Nenhum documento exigido para esta cirurgia.',
      pronta: 'Documentos em dia: a cirurgia pode ser confirmada e começar.',
      bloqueiaInicio: '{n} documento(s) impedem a entrada no bloco.',
      bloqueiaConfirmacao: '{n} documento(s) pendentes impedem a confirmação.',
      bloqueia: 'bloqueia o início',
      pendencia: 'pendência na confirmação',
      validade: 'validade de {n} dia(s)',
      estados: {
        pendente: 'Pendente',
        apresentado: 'Apresentado',
        vencido: 'Vencido',
        dispensado: 'Dispensado',
        recusado: 'Recusado',
      },
      registrar: 'Registrar',
      situacao: 'Situação',
      situacoes: { apresentado: 'Apresentado', dispensado: 'Dispensado', recusado: 'Recusado' },
      data: 'Data do documento',
      validoAte: 'Válido até (opcional)',
      digitalizado: 'Documento digitalizado do paciente',
      semDigitalizado: 'Sem arquivo',
      observacao: 'Justificativa ou observação',
      gravar: 'Gravar',
      cancelar: 'Cancelar',
      gravado: 'Documento registrado.',
      historico: 'Histórico ({n})',
      linhaHistorico: '{seq}. {descricao}: {situacao} · {quem} em {quando}',
    },
  },
});

const cliente = useQueryClient();
const { permissoes } = usarSessao();
const ve = computed(() => permissoes.value.has('cirurgia.agenda.ler'));
const podeRegistrar = computed(() => permissoes.value.has('cirurgia.agenda.agendar'));
const consulta = useQuery({
  queryKey: computed(() => ['cirurgia', 'documentos', props.agendamento]),
  queryFn: () => lerDocumentosDaCirurgia(props.agendamento),
  enabled: ve,
});
const d = computed(() => consulta.data.value);

const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const aberto = ref<number | null>(null);
const situacao = ref<SituacaoRegistroDocumento>('apresentado');
const apresentadoEm = ref(hoje());
const validoAte = ref('');
const digitalizado = ref('');
const observacao = ref('');
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);

const aceita = computed(
  () =>
    !!d.value &&
    ['solicitado', 'em_analise', 'agendado', 'confirmado', 'no_bloco'].includes(d.value.situacao),
);

/** O que falta para confirmar e para começar, pela mesma regra do servidor. */
const faltas = computed(() => {
  if (!d.value) return { inicio: 0, confirmacao: 0 };
  const exigidos = d.value.documentos;
  const registros = d.value.historico;
  const falta = (nova: string) => {
    const r = conferirDocumentosCirurgia(exigidos, registros, nova, d.value!.dataCirurgia);
    return r.ok ? 0 : r.faltam.length;
  };
  return { inicio: falta('no_bloco'), confirmacao: falta('confirmado') };
});

const opcoesSituacao = computed(() =>
  (['apresentado', 'dispensado', 'recusado'] as const).map((s) => ({
    valor: s,
    rotulo: t(`situacoes.${s}`),
  })),
);
const opcoesDigitalizado = computed(() => [
  { valor: '', rotulo: t('semDigitalizado') },
  ...(d.value?.digitalizados ?? []).map((x) => ({
    valor: String(x.id),
    rotulo: `${x.tipo}${x.descricao ? ` · ${x.descricao}` : ''}${x.data ? ` · ${x.data}` : ''}`,
  })),
]);

const problemas = computed(() => {
  const doc = d.value?.documentos.find((x) => x.tipo === aberto.value);
  if (!d.value || !doc) return [];
  return conferirRegistroDocumento(
    {
      situacao: situacao.value,
      observacao: observacao.value,
      apresentadoEm: situacao.value === 'apresentado' ? apresentadoEm.value || null : null,
      validoAte: validoAte.value || null,
    },
    {
      situacaoCirurgia: d.value.situacao,
      natureza: d.value.natureza,
      categoria: doc.categoria,
      hoje: hoje(),
    },
  );
});

function abrir(tipo: number): void {
  aberto.value = tipo;
  situacao.value = 'apresentado';
  apresentadoEm.value = hoje();
  validoAte.value = '';
  digitalizado.value = '';
  observacao.value = '';
  mensagem.value = null;
}

async function gravar(): Promise<void> {
  if (aberto.value === null || problemas.value.length) return;
  ocupado.value = true;
  erro.value = null;
  try {
    const apresentado = situacao.value === 'apresentado';
    await registrarDocumentoDaCirurgia(props.agendamento, {
      tipo: aberto.value,
      situacao: situacao.value,
      apresentadoEm: apresentado ? apresentadoEm.value : null,
      validoAte: apresentado && validoAte.value ? validoAte.value : null,
      observacao: observacao.value.trim() || null,
      digitalizado: apresentado && digitalizado.value ? Number(digitalizado.value) : null,
    });
    mensagem.value = t('gravado');
    aberto.value = null;
    await cliente.invalidateQueries({ queryKey: ['cirurgia'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

const descricaoDo = (tipo: number) =>
  d.value?.tipos.find((x) => x.id === tipo)?.descricao ??
  d.value?.documentos.find((x) => x.tipo === tipo)?.descricao ??
  String(tipo);
</script>

<template>
  <section
    v-if="ve"
    class="painel"
    aria-labelledby="documentos-cirurgia-titulo"
    data-testid="documentos-cirurgia"
  >
    <h2 id="documentos-cirurgia-titulo">{{ t('titulo') }}</h2>
    <ErroCirurgia v-if="consulta.isError.value" :erro="consulta.error.value" />
    <template v-if="d">
      <p v-if="!d.documentos.length" data-testid="documentos-nenhum">{{ t('nenhum') }}</p>
      <template v-else>
        <p v-if="!faltas.inicio && !faltas.confirmacao" role="status" data-testid="documentos-pronta">
          {{ t('pronta') }}
        </p>
        <p v-if="faltas.inicio" class="alerta" data-testid="documentos-bloqueio-inicio">
          {{ t('bloqueiaInicio', { n: faltas.inicio }) }}
        </p>
        <p v-if="faltas.confirmacao" class="alerta" data-testid="documentos-bloqueio-confirmacao">
          {{ t('bloqueiaConfirmacao', { n: faltas.confirmacao }) }}
        </p>
        <ul class="lista" data-testid="documentos-lista">
          <li v-for="doc in d.documentos" :key="doc.tipo" :data-testid="`documento-${doc.codigo}`">
            <div class="linha">
              <strong>{{ doc.descricao }}</strong>
              <span class="estado" :data-estado="doc.estado" :data-testid="`documento-estado-${doc.codigo}`">
                {{ t(`estados.${doc.estado}`) }}
              </span>
              <SanteBotao
                v-if="podeRegistrar && aceita && aberto !== doc.tipo"
                variante="texto"
                :rotulo="t('registrar')"
                :data-testid="`documento-registrar-${doc.codigo}`"
                @acionar="abrir(doc.tipo)"
              />
            </div>
            <small class="secundario">
              <span v-if="doc.bloqueia">{{ t('bloqueia') }}</span>
              <span v-else-if="doc.geraPendencia">{{ t('pendencia') }}</span>
              <span v-if="doc.validadeDias"> · {{ t('validade', { n: doc.validadeDias }) }}</span>
            </small>
            <form
              v-if="aberto === doc.tipo"
              class="formulario"
              :data-testid="`documento-form-${doc.codigo}`"
              @submit.prevent="gravar"
            >
              <SanteSelecao
                v-model="situacao"
                :rotulo="t('situacao')"
                :opcoes="opcoesSituacao"
                data-testid="documento-situacao"
              />
              <template v-if="situacao === 'apresentado'">
                <div class="campo">
                  <label for="documento-data">{{ t('data') }}</label>
                  <input
                    id="documento-data"
                    v-model="apresentadoEm"
                    type="date"
                    data-testid="documento-data"
                  />
                </div>
                <div class="campo">
                  <label for="documento-validade">{{ t('validoAte') }}</label>
                  <input
                    id="documento-validade"
                    v-model="validoAte"
                    type="date"
                    data-testid="documento-validade"
                  />
                </div>
                <SanteSelecao
                  v-model="digitalizado"
                  :rotulo="t('digitalizado')"
                  :opcoes="opcoesDigitalizado"
                  data-testid="documento-digitalizado"
                />
              </template>
              <SanteCampoTexto
                v-model="observacao"
                :rotulo="t('observacao')"
                :max-bytes="500"
                data-testid="documento-observacao"
              />
              <small
                v-for="p in problemas"
                :key="p.campo + p.mensagem"
                class="erro-campo"
                data-testid="documento-problema"
                >{{ p.mensagem }}</small
              >
              <div class="acoes">
                <SanteBotao
                  :rotulo="t('gravar')"
                  :desabilitado="problemas.length > 0 || ocupado"
                  data-testid="documento-gravar"
                  @acionar="gravar"
                />
                <SanteBotao variante="texto" :rotulo="t('cancelar')" @acionar="aberto = null" />
              </div>
            </form>
          </li>
        </ul>
      </template>
      <details v-if="d.historico.length" data-testid="documentos-historico">
        <summary>{{ t('historico', { n: d.historico.length }) }}</summary>
        <ol>
          <li v-for="h in d.historico" :key="h.id">
            {{
              t('linhaHistorico', {
                seq: h.sequencia,
                descricao: descricaoDo(h.tipo),
                situacao: t(`estados.${h.situacao}`),
                quem: h.conferente ?? '',
                quando: h.conferidoEm ?? '',
              })
            }}
            <span v-if="h.observacao"> · {{ h.observacao }}</span>
          </li>
        </ol>
      </details>
    </template>
    <p v-if="mensagem" role="status" data-testid="documentos-mensagem">{{ mensagem }}</p>
    <ErroCirurgia v-if="erro" :erro="erro" />
  </section>
</template>

<style scoped>
.lista {
  list-style: none;
  padding: 0;
  display: grid;
  gap: var(--sgh-espaco-2);
}
.linha {
  display: flex;
  gap: var(--sgh-espaco-2);
  align-items: center;
  flex-wrap: wrap;
}
.formulario {
  display: grid;
  gap: var(--sgh-espaco-2);
}
.acoes {
  display: flex;
  gap: var(--sgh-espaco-2);
}
.secundario,
.erro-campo {
  color: var(--sgh-texto-secundario);
}
.alerta {
  font-weight: 600;
}
</style>
