import type { SavedView, SavedViewsService } from '@apollosg/design-system';
import { apiHeaders, handle401 } from '../auth/session';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const P = `${BASE}/cadastro/grade-layout`;

/**
 * O layout da grade que **segue o operador** — o "Salvar Configurações do Grid [F8]" do legado, que lá era
 * um arquivo `.ini` no disco da estação (`uPrecificacaoNF.pas:1113`) e por isso se perdia quando a pessoa
 * trocava de máquina.
 *
 * Usado junto com o `persistId` do DataTable, não no lugar dele: o `persistId` guarda a cópia local, então a
 * grade abre com o layout certo **antes** de a resposta chegar e continua abrindo se o servidor estiver
 * fora; este serviço é o que faz o layout existir na outra máquina.
 *
 * ⚠️ **falhar aqui não pode quebrar a tela.** Layout é conforto: se a chamada falhar, a grade abre com o que
 * tem em cache (ou com o padrão) e o operador segue trabalhando. Por isso `list` devolve `[]` em erro, em
 * vez de estourar.
 */
export const gradeLayoutService: SavedViewsService = {
  list: async (persistId: string): Promise<SavedView[]> => {
    try {
      const r = await fetch(`${P}?tela=${encodeURIComponent(persistId)}`, { headers: apiHeaders() });
      handle401(r);
      if (!r.ok) return [];
      const linhas = (await r.json()) as Array<Record<string, unknown>>;
      return linhas.map((l) => ({
        id: String(l.id),
        name: String(l.name ?? l.id),
        isPublic: Boolean(l.isPublic),
        state: (l.state ?? {}) as SavedView['state'],
        createdAt: String(l.createdAt ?? new Date().toISOString()),
      }));
    } catch {
      return [];
    }
  },

  save: async (persistId: string, view: SavedView): Promise<SavedView> => {
    const r = await fetch(P, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({
        tela: persistId, id: view.id, name: view.name, isPublic: view.isPublic, state: view.state,
      }),
    });
    handle401(r);
    if (!r.ok) throw new Error('Não foi possível salvar o layout da grade.');
    return view;
  },

  delete: async (persistId: string, id: string): Promise<void> => {
    const r = await fetch(`${P}/${encodeURIComponent(persistId)}/${encodeURIComponent(id)}`, {
      method: 'DELETE', headers: apiHeaders(),
    });
    handle401(r);
    if (!r.ok) throw new Error('Não foi possível remover o layout da grade.');
  },
};
