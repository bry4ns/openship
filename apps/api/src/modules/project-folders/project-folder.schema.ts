import { Type, type Static } from "@sinclair/typebox";

export const CreateProjectFolderBody = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 100 }),
});

export const UpdateProjectFolderBody = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 100 }),
});

export type TCreateProjectFolderBody = Static<typeof CreateProjectFolderBody>;
export type TUpdateProjectFolderBody = Static<typeof UpdateProjectFolderBody>;
