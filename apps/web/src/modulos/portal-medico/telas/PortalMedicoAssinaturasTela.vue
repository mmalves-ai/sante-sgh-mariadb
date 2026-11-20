<script setup lang="ts">
// Assinaturas pendentes no portal do médico externo (W0-10, M6): `/medico-externo/assinaturas`, fora da casca interna.
// O servidor lista os documentos emitidos pelo profissional ligado à conta que pedem a assinatura ICP-Brasil (Lei 14.063
// art. 13) e o certificado em nuvem dele. O médico escolhe o lote, confirma num painel e vai ao provedor do certificado
// (PSC), que devolve à tela de retorno. Desligada (parâmetro ou provedor), mostra o motivo; sem o certificado em nuvem,
// orienta vincular no hospital. O documento assinado não se edita: nada aqui altera o conteúdo.
import {
  type DocumentoAssinaturaPortalMedico,
  type InicioAssinaturaPortalMedico,
  MOTIVOS_RECUSA_ASSINATURA,
  MOTIVOS_VALIDACAO_ICP,
} from '@sgh/contratos';
import { SanteBotao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  assinarPortalMedico,
  assinaturasPortalMedico,
  irAoProvedorAssinatura,
} from '../api-portal-medico.js';
import ErroPortalMedico from '../componentes/ErroPortalMedico.vue';
import PortalMedicoCasca from '../componentes/PortalMedicoCasca.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const pronto = ref(false);
const fila = useQuery({
  queryKey: ['portal-medico', 'assinaturas'],
  queryFn: assinaturasPortalMedico,
  enabled: pronto,
});
const quando = (d: string | null) =>
  d ? `${d.slice(0, 10).split('-').reverse().join('/')} ${d.slice(11, 16)}`.trim() : '—';
const dia = (d: string) => d.slice(0, 10).split('-').reverse().join('/');

const escolhidos = ref<number[]>([]);
const revisando = ref(false);
const ocupado = ref(false);
const erro = ref<unknown>(null);
const resposta = ref<InicioAssinaturaPortalMedico | null>(null);

const documentos = computed<readonly DocumentoAssinaturaPortalMedico[]>(
  () => fila.data.value?.documentos ?? [],
);
const podeAssinar = computed(
  () => !!fila.data.value?.ligada && !!fila.data.value.certificado && documentos.value.length > 0,
);
const todos = computed({
  get: () => documentos.value.length > 0 && escolhidos.value.length === documentos.value.length,
  set: (v: boolean) => {
    escolhidos.value = v ? documentos.value.map((d) => d.documento) : [];
  },
});
const tituloDe = (id: number) => documentos.value.find((d) => d.documento === id)?.titulo ?? `#${id}`;
const textoMotivo = (m: string) =>
  (MOTIVOS_RECUSA_ASSINATURA as Record<string, string>)[m] ??
  (MOTIVOS_VALIDACAO_ICP as Record<string, string>)[m] ??
  t('portalMedico.assinaturas.motivoGeral');

function revisar(): void {
  erro.value = null;
  resposta.value = null;
  revisando.value = true;
}

async function confirmar(): Promise<void> {
  if (!escolhidos.value.length) return;
  ocupado.value = true;
  erro.value = null;
  try {
    const r = await assinarPortalMedico({ documentos: [...escolhidos.value] });
    resposta.value = r;
    revisando.value = false;
    if (r.endereco) {
      irAoProvedorAssinatura(r.endereco);
      return;
    }
    escolhidos.value = [];
    await cliente.invalidateQueries({ queryKey: ['portal-medico', 'assinaturas'] });
  } catch (e) {
    erro.value = e;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <PortalMedicoCasca :titulo="t('portalMedico.assinaturas.titulo')" @sessao="pronto = true">
    <template #default>
      <p class="secundario">{{ t('portalMedico.assinaturas.explicacao') }}</p>
      <ErroPortalMedico v-if="erro" :erro="erro" />
      <ErroPortalMedico v-if="fila.error.value" :erro="fila.error.value" />
      <p v-else-if="!fila.data.value" role="status">{{ t('portalMedico.carregando') }}</p>
      <p v-else-if="!fila.data.value.vinculado" role="note" data-testid="pm-sem-vinculo">
        {{ t('portalMedico.semVinculo') }}
      </p>
      <p v-else-if="!fila.data.value.comLogin" role="note" data-testid="pm-ass-sem-login">
        {{ t('portalMedico.assinaturas.semLogin') }}
      </p>
      <template v-else>
        <p v-if="!fila.data.value.ligada" role="note" data-testid="pm-ass-desligada">
          {{
            t('portalMedico.assinaturas.desligada', {
              motivo: fila.data.value.motivoDesligada ?? '',
            })
          }}
        </p>
        <p v-else-if="!fila.data.value.certificado" role="note" data-testid="pm-ass-sem-certificado">
          {{ t('portalMedico.assinaturas.semCertificado') }}
        </p>
        <p v-else class="secundario" data-testid="pm-ass-certificado">
          {{
            t('portalMedico.assinaturas.certificado', {
              provedor: fila.data.value.certificado.provedor ?? '—',
              serie: fila.data.value.certificado.serie,
              cpf: fila.data.value.certificado.cpfMascarado,
              ate: dia(fila.data.value.certificado.validoAte),
            })
          }}
        </p>

        <div v-if="resposta && !resposta.endereco" role="status" data-testid="pm-ass-resposta">
          <p>{{ t('portalMedico.assinaturas.nadaAAssinar') }}</p>
        </div>
        <div v-if="resposta && resposta.recusados.length" role="note" data-testid="pm-ass-recusados">
          <p>{{ t('portalMedico.assinaturas.recusados') }}</p>
          <ul>
            <li v-for="r in resposta.recusados" :key="r.documento">
              {{ tituloDe(r.documento) }}: {{ textoMotivo(r.motivo) }}
            </li>
          </ul>
        </div>

        <table v-if="documentos.length" class="tabela" data-testid="pm-assinaturas">
          <thead>
            <tr>
              <th scope="col">
                <input
                  v-model="todos"
                  type="checkbox"
                  :disabled="!podeAssinar || ocupado"
                  :aria-label="t('portalMedico.assinaturas.todos')"
                  data-testid="pm-ass-todos"
                />
              </th>
              <th scope="col">{{ t('portalMedico.assinaturas.documento') }}</th>
              <th scope="col">{{ t('portalMedico.assinaturas.paciente') }}</th>
              <th scope="col">{{ t('portalMedico.assinaturas.emitidoEm') }}</th>
              <th scope="col">{{ t('portalMedico.assinaturas.situacao') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in documentos" :key="d.documento" :data-testid="`pm-ass-${d.documento}`">
              <td>
                <input
                  v-model="escolhidos"
                  type="checkbox"
                  :value="d.documento"
                  :disabled="!podeAssinar || ocupado"
                  :aria-label="t('portalMedico.assinaturas.selecionar', { titulo: d.titulo, nome: d.nome })"
                  :data-testid="`pm-ass-escolher-${d.documento}`"
                />
              </td>
              <td>
                <strong>{{ d.titulo }}</strong>
              </td>
              <td>{{ d.nome }}</td>
              <td>{{ quando(d.emitidoEm) }}</td>
              <td>{{ t(`portalMedico.assinaturas.situacoes.${d.situacao}`) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else data-testid="pm-ass-vazia">{{ t('portalMedico.assinaturas.nenhum') }}</p>
        <p v-if="fila.data.value.limitado" class="secundario">{{ t('portalMedico.assinaturas.limitado') }}</p>

        <p v-if="podeAssinar && !revisando" class="acoes">
          <SanteBotao
            :rotulo="t('portalMedico.assinaturas.revisar', { n: escolhidos.length })"
            :desabilitado="!escolhidos.length || ocupado"
            data-testid="pm-ass-revisar"
            @acionar="revisar"
          />
        </p>
        <div
          v-if="revisando && fila.data.value.certificado"
          class="painel"
          role="alertdialog"
          data-testid="pm-ass-confirmar"
        >
          <h3>{{ t('portalMedico.assinaturas.confirmarTitulo') }}</h3>
          <p>
            {{
              t('portalMedico.assinaturas.confirmarTexto', {
                n: escolhidos.length,
                serie: fila.data.value.certificado.serie,
              })
            }}
          </p>
          <ul>
            <li v-for="id in escolhidos" :key="id">{{ tituloDe(id) }}</li>
          </ul>
          <p v-if="ocupado" role="status">{{ t('portalMedico.assinaturas.indo') }}</p>
          <p class="acoes">
            <SanteBotao
              :rotulo="t('portalMedico.assinaturas.confirmar')"
              :desabilitado="ocupado"
              data-testid="pm-ass-sim"
              @acionar="confirmar"
            />
            <SanteBotao
              variante="texto"
              :rotulo="t('portalMedico.assinaturas.voltar')"
              @acionar="revisando = false"
            />
          </p>
        </div>
      </template>
    </template>
  </PortalMedicoCasca>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
<style scoped>
.painel {
  margin-top: var(--sgh-espaco-4);
}
</style>
